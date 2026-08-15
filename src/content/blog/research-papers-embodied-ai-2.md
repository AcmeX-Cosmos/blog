---
title: "Paper Reading: Embodied AI 2 - 具身推理、跨本体预训练与生成式控制"
date: "2026-08-16T08:05:00+08:00"
description: "从 ECoT、RoboPoint、GR-1、HPT、GR-2 到 GR00T N1，分析具身推理、空间可供性、视频先验、跨本体表示与实时动作生成。"
tags: ["Embodied AI", "具身智能", "机器人学习", "VLA", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/embodied-ai-architecture-map.svg"
references:
  - title: "Robotic Control via Embodied Chain-of-Thought Reasoning"
    meta: "arXiv 2407.08693 · 2024"
    url: "https://arxiv.org/abs/2407.08693"
  - title: "RoboPoint"
    meta: "arXiv 2406.10721 · 2024"
    url: "https://arxiv.org/abs/2406.10721"
  - title: "GR-1"
    meta: "arXiv 2312.13139 · 2023"
    url: "https://arxiv.org/abs/2312.13139"
  - title: "Heterogeneous Pre-trained Transformers"
    meta: "arXiv 2409.20537 · 2024"
    url: "https://arxiv.org/abs/2409.20537"
  - title: "GR-2"
    meta: "arXiv 2410.06158 · 2024"
    url: "https://arxiv.org/abs/2410.06158"
  - title: "GR00T N1"
    meta: "arXiv 2503.14734 · 2025"
    url: "https://arxiv.org/abs/2503.14734"
---

![Embodied AI architecture map](/blog/images/research/embodied-ai-architecture-map.svg)

这一篇关注一个比“模型能否输出动作”更严格的问题：语义知识怎样落到可验证的空间条件，异构数据怎样共享主干，以及低频推理怎样与高频控制解耦。六篇论文分别给出显式推理、中间表示、视频生成先验、跨本体 token 化和双系统控制的答案。

## ECoT

[Robotic Control via Embodied Chain-of-Thought Reasoning](https://arxiv.org/abs/2407.08693) 在动作之前显式预测任务计划、子任务、运动意图、目标框和末端位置。它不是把普通语言 CoT 直接接到机器人上，而是让推理步骤持续引用视觉观测与本体状态，避免语义正确但物理上无效的计划。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/ecot-architecture.webp" alt="ECoT 具身思维链与动作预测流程" loading="lazy" decoding="async" />
  <figcaption>ECoT：具身感知、子任务与运动推理先于动作 token。图源：<a href="https://arxiv.org/abs/2407.08693">论文原文</a>。</figcaption>
</figure>

训练数据由机器人轨迹自动扩写为具身推理标注，再用于微调 OpenVLA。价值在于可解释性与纠错接口，但代价是自回归推理增加控制延迟。部署时应缓存不随帧变化的高层计划，只在场景变化或执行失败时重算完整推理链。

## RoboPoint

[RoboPoint](https://arxiv.org/abs/2406.10721) 将语言到动作之间的接口收缩为二维可供性关键点。模型接收图像和指令，输出可操作位置；训练数据通过三维资产、相机投影与自动问答合成，无需逐点人工标注。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/robopoint-architecture.webp" alt="RoboPoint 空间可供性关键点预测架构" loading="lazy" decoding="async" />
  <figcaption>RoboPoint：用视觉语言模型预测可执行空间点。图源：<a href="https://arxiv.org/abs/2406.10721">论文原文</a>。</figcaption>
</figure>

关键点比自然语言坐标更精确，又比完整轨迹更容易跨机器人复用。不过二维点没有深度、法向与可达性，真实系统仍需 RGB-D 回投、抓取姿态生成、碰撞检测和 IK。它适合做感知接口，不应被当作控制器。

## GR-1

[GR-1](https://arxiv.org/abs/2312.13139) 把语言、历史图像和机器人状态组织成 GPT 风格序列，同时预测未来图像与动作。互联网视频预训练首先学习物体运动和场景动态，再用机器人轨迹把视觉变化对齐到可执行动作。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/gr1-architecture.webp" alt="GR-1 视频生成预训练与动作预测架构" loading="lazy" decoding="async" />
  <figcaption>GR-1：未来视觉预测与动作解码共享时序主干。图源：<a href="https://arxiv.org/abs/2312.13139">论文原文</a>。</figcaption>
</figure>

未来图像是强辅助目标：它迫使隐藏状态保留任务相关动力学，而不只拟合动作标签。工程上需要分别测量视觉预测误差、动作误差和闭环成功率，因为清晰的未来帧不保证末端轨迹可达，动作 MSE 也不等价于任务完成。

## HPT

[Scaling Proprioceptive-Visual Learning with Heterogeneous Pre-trained Transformers](https://arxiv.org/abs/2409.20537) 用 embodiment-specific stem 将不同相机与本体状态压缩成短 token，再交给共享 Transformer trunk；下游机器人通过新的 stem 与 action head 适配。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/hpt-architecture.webp" alt="HPT 输入 stem、共享主干与动作头架构" loading="lazy" decoding="async" />
  <figcaption>HPT：异构输入先对齐为统一 token，再共享策略主干。图源：<a href="https://arxiv.org/abs/2409.20537">论文原文</a>。</figcaption>
</figure>

这种分层明确区分“可迁移知识”和“硬件接口”。真正决定迁移质量的是 token 是否保留动作相关几何，以及数据混合是否避免大数据源压制小本体。评估应包含冻结主干、全量微调与从零训练，才能判断收益来自预训练还是额外参数。

## GR-2

[GR-2](https://arxiv.org/abs/2410.06158) 将 GR-1 扩展到更大规模视频语言预训练，并在机器人数据上联合学习视频生成与动作预测。模型先预测任务条件下的未来视觉，再让动作分支读取视觉动态表示，形成“想象后行动”的结构。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/gr2-architecture.webp" alt="GR-2 视频语言动作联合生成架构" loading="lazy" decoding="async" />
  <figcaption>GR-2：互联网视频先验经机器人轨迹对齐到动作空间。图源：<a href="https://arxiv.org/abs/2410.06158">论文原文</a>。</figcaption>
</figure>

视频先验改善新背景和新物体泛化，但仍缺少力、接触和执行器动力学。部署时应把生成视频看作隐式计划，而不是物理保证；接触阶段仍需状态估计、阻抗控制与失败检测闭环兜底。

## GR00T N1

[GR00T N1](https://arxiv.org/abs/2503.14734) 采用双系统架构：System 2 的视觉语言模块理解场景和指令，System 1 的 diffusion transformer 以更高频率生成连续动作块。训练混合真实轨迹、人类视频和合成数据，并显式面向人形机器人与双臂操作。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/groot-n1-architecture.webp" alt="GR00T N1 视觉语言与扩散动作双系统架构" loading="lazy" decoding="async" />
  <figcaption>GR00T N1：慢速语义推理与快速扩散控制协同。图源：<a href="https://arxiv.org/abs/2503.14734">论文原文</a>。</figcaption>
</figure>

双系统设计直接回应控制频率矛盾：大模型不必逐控制周期运行，动作专家也不必承担开放世界语义。复现时最重要的不是模型总参数量，而是两系统的条件接口、动作 horizon、重规划触发器和跨本体归一化。

| 路线 | 中间表示 | 主要收益 | 主要风险 |
| --- | --- | --- | --- |
| ECoT / RoboPoint | 推理 token / 关键点 | 可解释、可组合 | 延迟与二维歧义 |
| GR-1 / GR-2 | 未来视频 | 利用视频动力学先验 | 缺少接触物理 |
| HPT | 统一策略 token | 跨本体共享 | 负迁移与接口损失 |
| GR00T N1 | 双系统条件 | 语义与实时控制解耦 | 系统复杂度较高 |
