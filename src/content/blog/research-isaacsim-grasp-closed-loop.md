---
title: "Isaac Sim 抓取闭环复盘：物理判据、运动不变量与失败归因"
date: "2026-08-15"
description: "以现有双臂 Pick-and-Place 代码为对象，分析从预抓取到放置验收的状态机、物理判据和仿真特权，建立可用于回归测试的失败分类。"
tags: ["Isaac Sim", "运动规划", "闭环系统", "机器人抓取", "Sim-to-Real"]
category: "research"
references:
  - title: "Isaac Sim Documentation"
    meta: "NVIDIA Robotics Simulation"
    url: "https://docs.isaacsim.omniverse.nvidia.com/"
  - title: "RMPflow"
    meta: "Cheng et al. · 2018"
    url: "https://arxiv.org/abs/1811.07049"
  - title: "cuRobo"
    meta: "Sundaralingam et al. · ICRA 2023"
    url: "https://arxiv.org/abs/2303.17297"
---

## 抓取系统的研究对象是状态转换

现有 S5 代码已经不是一段“移动到目标点”的脚本，而是一条包含快速 IK 预检、Lula/RRT、夹爪接触、测试抬升、搬运安全层和放置验收的闭环。评价它时，实验单位应是状态转换是否满足不变量，而不是动画是否看起来完成。

可以把流程写成

```text
PERCEIVE -> PRECHECK -> HOVER -> ALIGN -> APPROACH
-> CLOSE -> VERIFY_GRASP -> LIFT -> CARRY
-> LOWER -> RELEASE -> VERIFY_PLACE -> RETREAT
```

每个箭头都必须产生结构化证据。失败发生在哪个状态，决定下一步应该重感知、换抓取候选、换路径还是直接终止。

## 三个关键物理不变量

第一，接近阶段夹爪碰撞体必须始终高于桌面安全面。代码已经从左右夹指 collision bounds 计算最低点，而不是只看 TCP；这是必要的，因为 TCP 安全不代表指尖安全。应记录整条轨迹上的最小间隙

$$
c_{min}=\min_{t,k}(z^{finger}_{t,k}-z_{table}),
$$

并将 `c_min < margin` 设为硬失败。

第二，闭合后不能仅凭关节命令成功认定抓住。当前实现联合使用夹爪反馈残差、测得 effort、物体闭合位移和 2 cm 测试抬升；只有接触确认后才允许完整 lift。这比“夹爪闭合即成功”更接近真实系统，但仿真 effort 的可信度取决于驱动参数，必须用无物体闭合、软物体和刚体三组标定阈值。

第三，释放前必须确认末端到达放置区域。代码刻意在 `lower_ok=false` 时不松爪，避免把中途掉落记作成功。最终还同时检查 XY 误差和高于桌面的高度，这揭示了一个常见错误：二维距离无法区分“在篮子里”和“在篮子旁边的桌面上”。

## 仿真冻结与附着不能混进主结果

系统在预抓取阶段把目标切成 kinematic，接触确认后可启用 simulated attachment。这两项机制有工程价值：前者防止规划期间目标漂移，后者绕过接触求解器不稳定。但它们也引入仿真特权。

论文式实验必须至少报告两条结果线：

| 设置 | 目的 | 可以说明什么 |
| --- | --- | --- |
| Kinematic pregrasp + attachment | 调试感知、规划和放置逻辑 | 系统几何链路上界 |
| Dynamic object + contact only | 接近真实物理 | 抓取与搬运闭环能力 |

若只报告 attachment 组，成功率主要证明约束创建成功，而不是夹爪真正稳定持物。更严格的做法是在 attach 前验证物体中心位于双指之间，并量化 Fabric 与 USD 位姿同步误差；当前代码已经做了这两项检查，可以直接纳入日志。

## 路径规划不是单一算法开关

当前策略先尝试多个 hover clearance，再以稀疏关键姿态构造“抬升 -> 水平搬运 -> 下放”的安全层，关键姿态之间经过 RRT 与平滑插值。这里真正要控制的是四类约束：关节限位、环境碰撞、双臂 TCP 间距和每帧最大关节步长。

minimum-jerk 时间标度

$$
s(\tau)=10\tau^3-15\tau^4+6\tau^5
$$

只保证端点速度与加速度平滑，并不自动保证笛卡尔碰撞安全。插值后的每一帧仍需复查碰撞和最小间隙。对于双臂任务，两条轨迹共享同一 frame count 只是时间同步的第一步，还要检查整段 TCP-TCP 和 link-link 距离。

## 一套可归因的实验协议

固定物体、容器和机器人初态种子，对每个场景运行以下消融：Scene pose/GraspNet-T/GraspNet-6D；是否 simulated attachment；RRT 与解析安全层；不同桌面间隙；不同深度噪声。每次运行保存状态级结果，而不是只存最终布尔值。

核心指标应包括：感知有效率、首个可达候选排名、规划成功率、最小桌面间隙、接触确认率、抬升成功率、搬运掉落率、放置误差、总耗时及 P95。最终成功率可分解为

$$
P(S)=P(G)P(L\mid G)P(C\mid L)P(P\mid C),
$$

其中 $G,L,C,P$ 分别代表抓住、抬升、搬运和放置。这个分解能明确系统瓶颈，而不是把所有失败归到“GraspNet 不准”或“Isaac 物理不稳定”。

## Sim-to-Real 的替换顺序

迁移时先替换测量接口，再替换执行接口：用真实标定外参替代 USD 世界位姿，用真实 RGB-D 噪声模型替代理想深度，用编码器/电流/力传感替代仿真 contact 和 Prim 位姿，最后再调整规划与控制参数。这样每一步都保留上一阶段的可对照基线。

最值得保留的不是仿真中的某个阈值，而是“任何动作都必须由下一帧物理状态验收”的架构原则。它同样适用于 ACT 和 VLA：学习策略可以提出动作，但不能自己宣布任务完成。
