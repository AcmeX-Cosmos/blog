---
title: "AuraVLA GraspNet 多帧融合：把单帧抓取候选变成可验收的观测"
date: "2026-08-17"
description: "记录 AuraVLA 在 RGB-D 抓取链路中引入三帧 GraspNet 时序融合、质量加权、Median/MAD 异常剔除与四元数平均的工程实现，以及它如何暴露真实的夹爪标定和工作空间问题。"
tags: ["AuraVLA", "GraspNet", "RGB-D", "机器人抓取", "感知融合", "工程实践"]
category: "tech"
references:
  - title: "GraspNet-1Billion"
    meta: "Fang et al. · Grasp Pose Detection"
    url: "https://graspnet.net/"
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 单帧结果为什么不够

GraspNet 可以在一张 RGB-D 图像中给出高质量的抓取候选，但单帧结果仍然会受到深度空洞、遮挡、渲染抖动和偶发错误候选的影响。把最高分候选直接交给运动规划器，会把感知噪声放大成末端姿态抖动，最终表现为 IK 失败、夹爪轴不对齐或接触后滑落。

这次改动的目标不是让模型“多猜几个结果”，而是把抓取候选当成一组带质量证据的观测：只有在短时间窗口内具有一致性、几何上有效且置信度足够时，才允许进入后续规划。

## 三帧采样与观测契约

每次抓取采集 `3` 帧 RGB-D，帧间隔为 `0.12 s`。每帧被转换为统一的 `GraspObservation`，至少包含：

- 抓取中心位置 `position`；
- 末端姿态四元数 `orientation`；
- GraspNet 原始 `score`；
- 深度有效性 `depth_quality`；
- 目标包围盒校验结果 `geometric_validity`；
- 单调时间戳和来源帧标识。

这层契约把“模型认为可以抓”与“当前相机数据足以支撑执行”分开。缺少有限位置、有限四元数或有效深度的观测会在进入融合前被拒绝，不会被零值或上一帧结果静默替代。

实现集中在 `aura_hardware/aura_isaac_bridge/core/grasp_fusion.py`；`perception.py` 负责提供多帧 RGB-D 观测，`task.py` 只消费融合后的候选并继续执行安全门。采样数量、离散度和置信度阈值统一放在 `aura_bringup/config/config.yaml`，避免把实验参数散落在控制逻辑中。

## 质量加权，而不是简单平均

融合权重同时考虑模型分数、深度质量和几何有效性：

$$
w_i = s_i \cdot q_i^{depth} \cdot q_i^{geometry}
$$

其中 `s_i` 是 GraspNet score，后两项分别反映深度采样是否可靠、候选点是否落在目标有效包围盒内。位置使用加权平均前的稳健筛选；姿态则在四元数空间内处理，避免直接对欧拉角求平均造成万向节和跨边界问题。

## Median/MAD 剔除时间异常值

三帧样本很少，不能依赖大样本统计。因此实现先计算位置坐标的中位数和 Median Absolute Deviation（MAD），再用配置的最小离群阈值约束异常点。当前工程参数为：

| 参数 | 当前值 | 作用 |
| --- | ---: | --- |
| `frame_count` | `3` | 单次抓取的短时观测数 |
| `frame_interval_sec` | `0.12` | 相邻 RGB-D 采样间隔 |
| `position_outlier_floor_m` | `0.012` | MAD 阈值下限，避免阈值退化 |
| `max_position_dispersion_m` | `0.025` | 融合后位置最大离散度 |
| `max_orientation_dispersion_deg` | `25.0` | 融合后姿态最大离散度 |
| `min_confidence` | `0.10` | 允许进入规划的最低融合置信度 |

异常值剔除后，如果剩余观测的空间离散度或姿态离散度仍超限，融合器返回拒绝，而不是回退到某一帧的结果。这样，失败原因会停留在感知层，便于定位相机、深度或目标遮挡问题。

## 四元数半球对齐与姿态融合

姿态四元数 `q` 与 `-q` 表示同一个旋转，但直接平均会产生错误的中间方向。实现先以参考四元数为基准做半球对齐：当 `dot(q_i, q_ref) < 0` 时翻转 `q_i`，再通过 Markley 方法求加权平均。最终同时输出姿态离散度，避免只返回一个看似稳定的平均值。

融合结果附带 `frame_count`、接受/拒绝帧数、位置标准差、姿态离散度和 `confidence`。这些字段进入任务日志，后续可以区分“模型低置信度”和“多帧不一致”两类失败。

## 融合之后仍有硬安全门

时序融合只解决观测稳定性，不替代物理和运动学验收。融合结果仍需依次通过：

1. GraspNet 可用性和目标包围盒检查；
2. 夹爪闭合轴、开口宽度和最大倾角 `15°` 检查；
3. Lula IK/RRT 可达性与碰撞安全门；
4. 真实夹爪接触确认和抬升后的几何验证。

GraspNet 与 SAM 现在在运行时缓存，避免每次抓取重复加载模型；VLM 只负责语义任务解析，不参与抓取点校准。感知、语义和执行边界因此保持清晰，任何一层拒绝都能保留结构化原因。

## 验证结果与真实失败

新增的 GraspNet 融合单元测试与运动规划测试共 `7 passed`，同时通过 `py_compile` 和 `git diff --check`。Isaac Sim VS Code Edition 热重载后，任务桥与相机桥状态正常。

回归用例覆盖有限值校验、质量权重、位置异常值剔除、四元数半球对齐和离散度拒绝；它们验证的是融合器的决策边界，而不是用少量样例宣称端到端成功率。

在实际任务中，香蕉样例因夹爪轴对齐检查安全停止，日志中的 `alignment=0.879` 代表未达到当前阈值，不是成功率；蓝色罐头样例则在 Lula 完整抓取与抬升可达性检查处停止。失败被明确暴露为夹爪轴标定和机械臂工作空间问题，融合器没有用不可靠的单帧结果掩盖它们。

## 小结

这次优化将抓取感知从“选一个最高分点”改成“对一组观测进行质量评估、稳健融合和显式拒绝”。它不承诺在遮挡或标定错误时继续执行，而是把不确定性传递到可观测的错误边界；对 AuraVLA 这样的闭环系统来说，可解释的停止比伪造一次成功更有工程价值。
