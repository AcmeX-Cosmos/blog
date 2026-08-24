---
title: "AuraVLA 轨迹规划实践：稀疏关键姿态与抓取姿态保持"
date: "2026-07-14"
description: "解析 AuraVLA 的 SparseKeyposeDiffuser、minimum-jerk 采样、双臂同步和固定抓取姿态策略。"
tags: ["AuraVLA", "Isaac Sim", "Motion Planning", "轨迹规划", "双臂机器人", "算法实现"]
category: "algorithm"
references:
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 问题定义

VLM 或任务规划器输出的是少量关键姿态，控制器却需要连续的关节目标。直接在两个 RRT 端点之间做关节线性插值，会让 TCP 在转角处横向扫过已抓取物体；运输阶段的腕部补偿还可能改变夹爪闭合方向。

## SparseKeyposeDiffuser

AuraVLA 先将关键姿态分为笛卡尔路径和关节路径两类。笛卡尔段按最大间距插值；关节段根据折线长度和最大单步变化计算帧数，并保留最小帧数。默认配置为：

| 参数 | 默认值 |
| --- | ---: |
| `cartesian_spacing_m` | `0.04 m` |
| `max_joint_step_rad` | `0.008 rad` |
| `min_frames` | `8` |
| `dual_arm_min_tcp_separation_m` | `0.18 m` |

关节路径的帧数估计为：

$$
N=\max\left(N_{min},\left\lceil\frac{1.875L}{\Delta q_{max}}\right\rceil\right)
$$

其中 $L$ 是关节折线长度，$\Delta q_{max}$ 是单步上限。它不是为了制造更多轨迹点，而是让步进上限和物理仿真频率有明确关系。

## Minimum-jerk 采样

每段使用：

$$
s(p)=p^3(10-15p+6p^2),\qquad p\in[0,1]
$$

起点和终点速度、加速度均趋近于零，RRT 转角不会被一条全局直线高速穿过。采样后仍需检查有限值、终点误差和桌面净空，minimum-jerk 不是碰撞规划的替代品。

## 双臂同步与姿态约束

左右臂分别计算所需帧数，再使用较大帧数同步采样。同步完成后逐帧计算 TCP 距离；最小间距低于阈值立即拒绝执行，而不是等到仿真发生碰撞。

最近的运动修复删除了运输阶段隐式的世界 Z 轴腕部旋转，保持已验证的抓取姿态。固定姿态下 IK/RRT 无解时返回失败，不通过改变腕部方向绕过物理约束。

## 验证方法

- 对同一组关键姿态比较关节线性插值和 diffuser 轨迹的 TCP 横向偏移；
- 记录每段最大关节步长、轨迹帧数和 minimum-jerk 终点误差；
- 统计双臂最小 TCP 距离与拒绝原因；
- 抓取运输前后比较末端姿态误差和物体相对位姿；
- 仿真中开启轨迹可视化，任务结束后清理旧 marker。

## 小结

AuraVLA 的轨迹模块把“少量关键姿态”转换为受步长、姿态和 TCP 间距约束的可执行路径。平滑采样只能降低冲击，真正的安全性来自固定抓取姿态、逐帧几何检查和失败即拒绝。
