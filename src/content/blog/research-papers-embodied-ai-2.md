---
title: "Paper Reading: Embodied AI 2 - 具身推理、跨本体预训练与生成式控制"
date: "2026-03-22"
description: "以 ECoT、RoboPoint、GR-1、HPT、GR-2 和 GR00T N1 为案例，追踪具身中间表示如何连接推理、视频先验与实时控制。"
tags: ["Embodied AI", "具身智能", "机器人学习", "VLA", "论文合集"]
category: "research"
cover: "/images/research/embodied-ai-architecture-map.svg"
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

![Embodied AI architecture map](/images/research/embodied-ai-architecture-map.svg)

这一篇把“具身能力”拆成几个可检查的接口：语言计划如何变成空间约束，视频表征如何变成可执行动作，不同机器人如何共享一部分参数，以及慢速语义模块怎样不阻塞控制循环。六项工作提供了不同的中间层，我更关注这些层在误差、延迟和硬件差异下能否继续工作。

## ECoT

[Robotic Control via Embodied Chain-of-Thought Reasoning](https://arxiv.org/abs/2407.08693) 将动作生成拆成计划、子任务、运动意图、目标区域和末端位置等中间预测。关键变化是推理内容被约束到当前观测与本体状态，而不是生成一段与物理状态无关的自然语言解释。

<figure class="paper-figure">
  <img src="/images/research/papers/ecot-architecture.webp" alt="ECoT 具身思维链与动作预测流程" loading="lazy" decoding="async" />
  <figcaption>阅读重点：具身中间变量怎样逐步收紧动作搜索空间。图源：<a href="https://arxiv.org/abs/2407.08693">论文原文</a>。</figcaption>
</figure>

机器人轨迹被自动扩写成带阶段和空间变量的监督，再用于策略微调。我的复现会把高层计划缓存起来，只在观测变化、阶段完成或执行失败时重算；同时记录完整推理链耗时，避免“可解释”换来控制频率下降。

## RoboPoint

[RoboPoint](https://arxiv.org/abs/2406.10721) 选择二维可供性点作为语言与动作之间的轻量接口：模型只需回答“应该接触哪里”，而不是一次性预测完整轨迹。三维资产投影和自动问答为这一接口提供了规模化监督。

<figure class="paper-figure">
  <img src="/images/research/papers/robopoint-architecture.webp" alt="RoboPoint 空间可供性关键点预测架构" loading="lazy" decoding="async" />
  <figcaption>阅读重点：二维接触点如何把开放指令转成下游几何问题。图源：<a href="https://arxiv.org/abs/2406.10721">论文原文</a>。</figcaption>
</figure>

关键点确实便于跨机器人复用，但它没有深度、表面法向和可达性。接入抓取链路时，我会把 RGB-D 回投、姿态采样、碰撞检查和 IK 明确列为后处理，避免把感知接口误当成控制器。

## GR-1

[GR-1](https://arxiv.org/abs/2312.13139) 把语言、图像历史和本体状态放进统一时序序列，并同时学习未来画面和动作。先从互联网视频获取运动规律，再用机器人轨迹校准动作，等于给策略增加了一个“事情接下来会怎样”的辅助目标。

<figure class="paper-figure">
  <img src="/images/research/papers/gr1-architecture.webp" alt="GR-1 视频生成预训练与动作预测架构" loading="lazy" decoding="async" />
  <figcaption>阅读重点：未来观测预测如何与动作头共享时序状态。图源：<a href="https://arxiv.org/abs/2312.13139">论文原文</a>。</figcaption>
</figure>

未来图像会迫使隐状态记住运动线索，但视觉上预测得像并不代表关节轨迹可执行。我会把画面预测、动作误差和闭环成功率分开报告，并增加接触阶段的失败统计，避免用单一 MSE 代表任务能力。

## HPT

[Scaling Proprioceptive-Visual Learning with Heterogeneous Pre-trained Transformers](https://arxiv.org/abs/2409.20537) 先为各机器人配置输入 stem，把不同相机布局和本体状态编码成统一长度的 token，再由共享 Transformer 处理。更换机器人时主要更新输入 stem 和动作头，主干中的跨任务表示得以保留。

<figure class="paper-figure">
  <img src="/images/research/papers/hpt-architecture.webp" alt="HPT 输入 stem、共享主干与动作头架构" loading="lazy" decoding="async" />
  <figcaption>阅读重点：硬件专用输入层与可迁移策略主干的边界。图源：<a href="https://arxiv.org/abs/2409.20537">论文原文</a>。</figcaption>
</figure>

这种拆分让“通用知识”和“硬件适配”有了可操作边界。实验不能只比较最终成功率，还应做冻结主干、只训 stem、全量微调和从零训练四组对照，并检查大数据机器人是否压制了小数据本体的梯度。

## GR-2

[GR-2](https://arxiv.org/abs/2410.06158) 延续视频预测与动作联合学习，但把预训练规模和视频语言能力进一步扩大。动作分支读取条件未来的动态表示，策略先在隐式未来中筛选方向，再输出机器人动作。

<figure class="paper-figure">
  <img src="/images/research/papers/gr2-architecture.webp" alt="GR-2 视频语言动作联合生成架构" loading="lazy" decoding="async" />
  <figcaption>阅读重点：视频动态先验经过哪一层对齐到本体动作。图源：<a href="https://arxiv.org/abs/2410.06158">论文原文</a>。</figcaption>
</figure>

这类先验更擅长外观和运动趋势，难以凭视频学到接触力与执行器限制。实际接入时应把生成结果视为候选计划，接触阶段交给状态估计、阻抗控制和失败检测兜底。

## GR00T N1

[GR00T N1](https://arxiv.org/abs/2503.14734) 把高层视觉语言推理与低层扩散控制拆成两个时间尺度：System 2 负责场景和指令，System 1 按更高频率产生连续动作块。真实轨迹、公开视频和合成数据共同覆盖人形及双臂场景。

<figure class="paper-figure">
  <img src="/images/research/papers/groot-n1-architecture.webp" alt="GR00T N1 视觉语言与扩散动作双系统架构" loading="lazy" decoding="async" />
  <figcaption>阅读重点：高层条件如何稳定地传递给高频扩散动作头。图源：<a href="https://arxiv.org/abs/2503.14734">论文原文</a>。</figcaption>
</figure>

双系统降低了“每个控制周期都运行大模型”的压力，但系统边界也成为新的故障点。复现时我会固定条件刷新频率、动作 horizon、重规划触发器和本体归一化规则，再测量高层延迟抖动对低层执行的影响。

| 路线 | 中间表示 | 主要收益 | 主要风险 |
| --- | --- | --- | --- |
| ECoT / RoboPoint | 推理 token / 关键点 | 可解释、可组合 | 延迟与二维歧义 |
| GR-1 / GR-2 | 未来视频 | 利用视频动力学先验 | 缺少接触物理 |
| HPT | 统一策略 token | 跨本体共享 | 负迁移与接口损失 |
| GR00T N1 | 双系统条件 | 语义与实时控制解耦 | 系统复杂度较高 |
