---
title: "Paper Reading: Embodied AI 3 - 数据规模、偏好对齐与视频世界模型"
date: "2026-08-16T08:06:00+08:00"
description: "围绕 AgiBot World、GRAPE、RoboBrain、Scenethesis、Large Behavior Models 与 Vidar，讨论数据、评估、世界模型和跨本体适配。"
tags: ["Embodied AI", "机器人数据", "世界模型", "策略评估", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/embodied-ai-architecture-map.svg"
references:
  - title: "AgiBot World Colosseo"
    meta: "arXiv 2503.06669 · 2025"
    url: "https://arxiv.org/abs/2503.06669"
  - title: "GRAPE"
    meta: "arXiv 2411.19309 · 2024"
    url: "https://arxiv.org/abs/2411.19309"
  - title: "RoboBrain"
    meta: "arXiv 2502.21257 · 2025"
    url: "https://arxiv.org/abs/2502.21257"
  - title: "Scenethesis"
    meta: "arXiv 2505.02836 · 2025"
    url: "https://arxiv.org/abs/2505.02836"
  - title: "Large Behavior Models"
    meta: "arXiv 2507.05331 · 2025"
    url: "https://arxiv.org/abs/2507.05331"
  - title: "Vidar"
    meta: "arXiv 2507.12898 · 2025"
    url: "https://arxiv.org/abs/2507.12898"
---

![Embodied AI architecture map](/blog/images/research/embodied-ai-architecture-map.svg)

本篇不把“规模化”简化为堆轨迹。有效规模至少包含数据定义、质量控制、失败样本、跨本体接口和统计可信的评估。随后再讨论视频世界模型如何作为跨机器人先验，以及最少量真机数据怎样完成动作对齐。

## AgiBot World Colosseo

[AgiBot World Colosseo](https://arxiv.org/abs/2503.06669) 建立百万级轨迹平台，覆盖多场景、多任务、夹爪与灵巧手，并通过标准化采集和人工复核控制数据质量。配套 GO-1 使用潜动作表示吸收异构轨迹，让动作语义先于具体控制维度对齐。

<figure class="paper-figure"><img src="/blog/images/research/papers/agibot-world-architecture.webp" alt="AgiBot World 数据平台与 GO-1 策略架构" loading="lazy" decoding="async" /><figcaption>AgiBot World：数据采集、质量控制与通用策略共同构成扩展闭环。图源：<a href="https://arxiv.org/abs/2503.06669">论文原文</a>。</figcaption></figure>

规模结论只有在任务分布、成功判据和采样权重透明时才可信。复现应保留原始时间戳、相机标定、动作坐标系和失败轨迹，并按机器人、任务和场景分层划分测试集，避免相邻轨迹泄漏。

## GRAPE

[GRAPE](https://arxiv.org/abs/2411.19309) 不只对成功演示做行为克隆，而是用成功与失败轨迹建立偏好对。VLM 产生阶段性关键点约束，轨迹级偏好优化再按成功、安全或效率目标对齐 VLA。

<figure class="paper-figure"><img src="/blog/images/research/papers/grape-architecture.webp" alt="GRAPE 关键点约束与轨迹偏好对齐流程" loading="lazy" decoding="async" /><figcaption>GRAPE：用可定制时空约束构造轨迹偏好。图源：<a href="https://arxiv.org/abs/2411.19309">论文原文</a>。</figcaption></figure>

其贡献是把“更好动作”提升为整条轨迹的任务目标，但偏好质量受约束生成器影响。工程上要审计碰撞、路径长度和完成度是否被同一标量奖励错误折叠，并单独报告各项指标。

## RoboBrain

[RoboBrain](https://arxiv.org/abs/2502.21257) 把机器人所需能力拆成任务规划、可供性理解与末端轨迹预测。ShareRobot 数据集为同一场景提供多层标注，模型通过多阶段训练把抽象语言逐步落到空间区域和轨迹。

<figure class="paper-figure"><img src="/blog/images/research/papers/robobrain-architecture.webp" alt="RoboBrain 从规划到可供性和轨迹的统一模型" loading="lazy" decoding="async" /><figcaption>RoboBrain：从抽象计划逐级产生空间与轨迹输出。图源：<a href="https://arxiv.org/abs/2502.21257">论文原文</a>。</figcaption></figure>

这类统一模型应分层验收：计划是否正确、目标区域是否可操作、轨迹是否几何连续、控制器是否可执行。只看最终任务分数会掩盖前层错误被后处理偶然修正的情况。

## Scenethesis

[Scenethesis](https://arxiv.org/abs/2505.02836) 用 LLM 起草场景布局，视觉模块提供空间关系，优化器处理碰撞与稳定性，judge 模块再检查一致性。它以训练外的 agentic pipeline 生成可交互三维场景，适合扩充仿真训练分布。

<figure class="paper-figure"><img src="/blog/images/research/papers/scenethesis-architecture.webp" alt="Scenethesis 三维场景规划、视觉校正与物理优化流程" loading="lazy" decoding="async" /><figcaption>Scenethesis：语言布局经过视觉与物理约束逐级校正。图源：<a href="https://arxiv.org/abs/2505.02836">论文原文</a>。</figcaption></figure>

对 Isaac Sim 一类平台，生成结果必须经过资产尺度、碰撞体、质量、关节和可导航区域检查。视觉上合理的场景并不自动具备物理可用性，数据生成管线应把这些检查写成可重复的 validator。

## Large Behavior Models

[A Careful Examination of Large Behavior Models](https://arxiv.org/abs/2507.05331) 的价值在评估方法：使用盲测、随机试验与置信区间比较多任务预训练和单任务基线，研究策略能力如何随数据规模与多样性变化。

<figure class="paper-figure"><img src="/blog/images/research/papers/lbm-architecture.webp" alt="Large Behavior Models 多任务训练与统计评估设计" loading="lazy" decoding="async" /><figcaption>LBM：把规模规律建立在受控真机试验上。图源：<a href="https://arxiv.org/abs/2507.05331">论文原文</a>。</figcaption></figure>

机器人成功率是二项随机变量，小样本差异很容易被偶然性放大。报告应包含每任务试验次数、Wilson 区间、失败类型和评测者盲化流程，而不是只给宏平均成功率。

## Vidar

[Vidar](https://arxiv.org/abs/2507.12898) 将互联网规模视频扩散模型作为通用动态先验，再用 masked inverse dynamics model 把预测变化映射到目标机器人的动作。掩码聚焦动作相关像素，降低背景和视角变化的干扰。

<figure class="paper-figure"><img src="/blog/images/research/papers/vidar-architecture.webp" alt="Vidar 视频扩散先验与掩码逆动力学适配器" loading="lazy" decoding="async" /><figcaption>Vidar：共享视频先验通过轻量逆动力学适配不同机器人。图源：<a href="https://arxiv.org/abs/2507.12898">论文原文</a>。</figcaption></figure>

“一个先验、多种本体”的关键瓶颈在 inverse dynamics：视觉上相似的变化可能对应不同关节轨迹。适配数据必须覆盖速度、负载、相机外参和接触模式；上线时还需对预测视频与真实观测的偏差做闭环监控。

| 层级 | 代表工作 | 应重点验证 |
| --- | --- | --- |
| 数据平台 | AgiBot World | 标定、分布与质量控制 |
| 目标对齐 | GRAPE | 偏好是否反映真实任务代价 |
| 抽象到动作 | RoboBrain | 分层输出的独立准确率 |
| 仿真扩展 | Scenethesis | 资产与物理有效性 |
| 规模评估 | LBM | 置信区间与盲测 |
| 视频先验 | Vidar | 跨本体逆动力学误差 |
