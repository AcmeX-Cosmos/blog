---
title: "GraspNet 推理链路审计：从特权提示到可执行 6D 抓取"
date: "2025-10-18"
description: "沿 Isaac Sim 中的 SAM + GraspNet 实现逐段检查输入、候选、坐标系与执行接口，区分网络精度、仿真特权信息和规划可达性。"
tags: ["GraspNet", "SAM", "RGB-D", "6D抓取", "Isaac Sim"]
category: "research"
references:
  - title: "GraspNet-1Billion"
    meta: "Fang et al. · CVPR 2020"
    url: "https://arxiv.org/abs/1912.13470"
  - title: "GraspNet Baseline"
    meta: "Official implementation"
    url: "https://github.com/graspnet/graspnet-baseline"
  - title: "Segment Anything"
    meta: "Kirillov et al. · ICCV 2023"
    url: "https://arxiv.org/abs/2304.02643"
---

## 先定义这条链路在测什么

本机 S5 实现的实际路径是：Isaac 相机输出 RGB 与 image-plane depth，USD 中已知目标 Prim 的世界中心投影成 SAM 正提示点，SAM 生成 mask，GraspNet baseline 产生抓取候选，最后经过相机轴和夹爪轴修正变换到世界系。

这里存在一个必须明确写进实验报告的边界：SAM 提示点来自仿真真值目标 Prim，而不是开放词表检测或人工点击。因此这条管线测量的是“已知目标实例条件下的抓取生成”，不能直接宣称为开放世界语义抓取。这个特权提示很有价值，它可以隔离抓取网络本身；但测试泛化时应另设 Grounding DINO/VLM 检测提示组，不能把两种设定混在同一个成功率里。

## RGB-D 输入契约

Isaac 深度以米为单位读取，当前代码乘 `1000` 并转成 `uint16`，随后改版 GraspNet demo 用 `factor_depth=1000` 还原为米。像素 $(u,v)$ 的反投影为

$$
z=\frac{d}{s},\qquad
x=(u-c_x)\frac{z}{f_x},\qquad
y=(v-c_y)\frac{z}{f_y}.
$$

这一链路必须同时记录 `depth.dtype`、有效深度比例、mask 内点数、相机内参和 RGB/depth 分辨率。只检查“mask 非空”不够：边界少量桌面点经过重复采样后可能被放大，产生分数很高但实际抓向桌面的候选。建议增加 mask 内深度中位数与 MAD 过滤，并报告 unique point ratio。

当前 `segment_target_with_sam()` 每次调用都构造 SAM 模型，推理结束后又清 CUDA cache。这样得到的不是稳定的在线延迟，而是模型加载、显存分配和推理混合延迟。部署测试应将 SAM 和 GraspNet 都变成长生命周期对象，分别记录预处理、SAM、点云、GraspNet、碰撞检测和坐标变换的 P50/P95。

## 候选选择不能只看网络分数

baseline 的 `demo_variable()` 完成模型无关碰撞过滤、NMS 和分数排序后返回单个候选。这一步已经把候选集合压缩掉，后续运动规划无法在“第二高分但可达”的抓取中选择。合理的接口应返回 top-K，并保留每个候选的

```text
score, translation, rotation, width,
collision_free, mask_support, ik_reachable,
path_length, minimum_clearance
```

最终排序可以写成

$$
J_i=w_q q_i+w_m r_i-w_c c_i-w_p \ell_i,
$$

但碰撞与 IK 更适合作为硬门控，而非能被高网络分数抵消的软惩罚。网络负责提出抓取，机器人几何负责决定它能否执行。

## 坐标变换要靠闭环验证

当前世界系变换是

$$
{}^WT_G={}^WT_C\,T_{camera\_axis}\,{}^CT_G\,T_{gripper\_axis}.
$$

其中两个轴修正矩阵分别处理 Isaac 相机坐标约定和 GraspNet 夹爪坐标约定。矩阵看起来合理并不能证明方向正确；转置、左右乘和四元数顺序都可能让位置“差不多对”而姿态翻转 180 度。

建议做三个单元实验：把相机系原点和三个单位轴变换到 USD 中可视化；将候选抓取的接近轴投回图像检查是否指向目标；把世界抓取位姿逆变换回相机系，要求位置和旋转的 round-trip error 接近数值精度。姿态误差用

$$
e_R=\cos^{-1}\left(\frac{\operatorname{tr}(R_{pred}^{\top}R_{ref})-1}{2}\right)
$$

而不是直接比较欧拉角。

## 为什么当前默认使用混合抓取

S5 默认 `USE_GRASPNET_ORIENTATION=false`：使用 GraspNet 的平移信息，但保留由物体长轴和机械臂约束得到的顶视姿态；完整 6D 姿态仅在开关打开时使用。这不是简单的降级，而是一组清晰的研究基线：

| 基线 | 位置 | 姿态 | 能回答的问题 |
| --- | --- | --- | --- |
| Scene pose | USD 真值 | 顶视解析姿态 | 规划与夹取执行的上界 |
| GraspNet-T | GraspNet | 顶视解析姿态 | 网络平移是否有价值 |
| GraspNet-6D | GraspNet | GraspNet | 任意姿态收益是否超过标定与可达性代价 |

每组都应在相同物体位姿和随机种子下运行，并按“无候选、坐标错误、IK 不可达、碰撞、未接触、抬升失败”分类。单个总成功率无法告诉你应该继续训练网络、修标定还是修改夹爪几何。

## 从仿真走向真实相机

真实部署需要逐项替换仿真特权：USD 中心投影换成检测器或 VLM grounding；理想深度加入空洞、飞点和边缘噪声；相机外参从直接读取世界位姿换成标定结果；物体 mesh 质心不再可用；最终成功不能读取 Prim 位置，而要由视觉、夹爪电流或力传感器确认。

因此最有含金量的结论不是“GraspNet 能抓”，而是量化每移除一项特权信息后成功率下降多少，并指出下降来自感知、几何还是控制。
