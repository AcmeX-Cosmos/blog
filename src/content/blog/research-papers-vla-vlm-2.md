---
title: "Paper Reading: VLA / VLM 2 - 潜动作、分层推理与高效策略"
date: "2026-08-16T08:04:00+08:00"
description: "分析 UniVLA、GraspVLA、A0、OneTwoVLA、Magma、CoT-VLA、Interleave-VLA 与 SmolVLA 的动作表示和训练范式。"
tags: ["VLA", "VLM", "多模态", "机器人基础模型", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/vla-vlm-architecture-map.svg"
references:
  - { title: "UniVLA", meta: "arXiv 2505.06111", url: "https://arxiv.org/abs/2505.06111" }
  - { title: "GraspVLA", meta: "arXiv 2505.03233", url: "https://arxiv.org/abs/2505.03233" }
  - { title: "A0", meta: "arXiv 2504.12636", url: "https://arxiv.org/abs/2504.12636" }
  - { title: "OneTwoVLA", meta: "arXiv 2505.11917", url: "https://arxiv.org/abs/2505.11917" }
  - { title: "Magma", meta: "arXiv 2502.13130", url: "https://arxiv.org/abs/2502.13130" }
  - { title: "CoT-VLA", meta: "arXiv 2503.22020", url: "https://arxiv.org/abs/2503.22020" }
  - { title: "Interleave-VLA", meta: "arXiv 2505.02152", url: "https://arxiv.org/abs/2505.02152" }
  - { title: "SmolVLA", meta: "arXiv 2506.01844", url: "https://arxiv.org/abs/2506.01844" }
---

![VLA and VLM architecture map](/blog/images/research/vla-vlm-architecture-map.svg)

第 1 篇建立了 VLM 连接器和主流动作头的基础。本篇进一步比较三类扩展方向：用潜动作吸收无标签视频，用层级结构分离语义与控制，以及用交错推理或小模型改善部署效率。

## UniVLA

[UniVLA](https://arxiv.org/abs/2505.06111) 在 DINO 特征空间学习 task-centric latent action，以相邻视频状态变化替代硬件相关控制量；部署到具体机器人时，再训练轻量动作解码器。
<figure class="paper-figure"><img src="/blog/images/research/papers/univla-architecture.webp" alt="UniVLA 潜动作学习与跨本体解码架构" loading="lazy" decoding="async" /><figcaption>UniVLA：共享潜动作与本体专用解码器解耦。图源：<a href="https://arxiv.org/abs/2505.06111">论文原文</a>。</figcaption></figure>
潜动作扩大了可用视频规模，但并不天然满足动力学可实现性。评估必须区分潜动作重建、目标机器人动作解码和闭环成功率。

## GraspVLA

[GraspVLA](https://arxiv.org/abs/2505.03233) 用十亿级合成动作数据预训练抓取基础模型，把视觉语言理解、抓取区域和连续控制统一起来。
<figure class="paper-figure"><img src="/blog/images/research/papers/graspvla-architecture.webp" alt="GraspVLA 合成抓取数据预训练架构" loading="lazy" decoding="async" /><figcaption>GraspVLA：大规模合成抓取先验经真实数据对齐。图源：<a href="https://arxiv.org/abs/2505.03233">论文原文</a>。</figcaption></figure>
合成规模能覆盖对象与视角，但域差异集中在材质、深度噪声、接触和执行器误差。落地时需要真实标定数据完成最后一公里对齐。

## A0

[A0](https://arxiv.org/abs/2504.12636) 采用可供性感知的层级模型：高层定位任务相关区域和阶段，低层策略在受限空间内生成动作，从而减少端到端模型同时承担语义与精确控制的压力。
<figure class="paper-figure"><img src="/blog/images/research/papers/a0-architecture.webp" alt="A0 可供性感知分层机器人策略" loading="lazy" decoding="async" /><figcaption>A0：高层可供性约束低层动作搜索。图源：<a href="https://arxiv.org/abs/2504.12636">论文原文</a>。</figcaption></figure>
层级系统的关键是阶段切换和异常恢复；高层区域错误若没有置信度门控，会把低层控制锁死在错误子空间。

## OneTwoVLA

[OneTwoVLA](https://arxiv.org/abs/2505.11917) 在快速直接动作与较慢显式推理之间自适应选择。简单状态走短路径，歧义或长时任务启用额外推理。
<figure class="paper-figure"><img src="/blog/images/research/papers/onetwovla-architecture.webp" alt="OneTwoVLA 自适应快慢推理架构" loading="lazy" decoding="async" /><figcaption>OneTwoVLA：按任务难度路由快慢策略。图源：<a href="https://arxiv.org/abs/2505.11917">论文原文</a>。</figcaption></figure>
路由器本身是安全关键组件。应测量误路由率、推理成本和恢复能力，而不只比较平均成功率。

## Magma

[Magma](https://arxiv.org/abs/2502.13130) 用 set-of-mark 与 trace-of-mark 把空间目标和时序运动编码进多模态模型，使同一基础模型支持 UI、导航和机器人动作。
<figure class="paper-figure"><img src="/blog/images/research/papers/magma-architecture.webp" alt="Magma 多模态智能体空间与动作标记架构" loading="lazy" decoding="async" /><figcaption>Magma：显式视觉标记连接语义推理与动作轨迹。图源：<a href="https://arxiv.org/abs/2502.13130">论文原文</a>。</figcaption></figure>
视觉标记提升可学习性，却依赖稳定检测与跨帧身份；遮挡和相似对象会直接污染后续动作条件。

## CoT-VLA

[CoT-VLA](https://arxiv.org/abs/2503.22020) 先生成视觉思维链，再预测动作，让中间推理保留几何信息，而不是只输出文本步骤。
<figure class="paper-figure"><img src="/blog/images/research/papers/cot-vla-architecture.webp" alt="CoT-VLA 视觉思维链与动作生成架构" loading="lazy" decoding="async" /><figcaption>CoT-VLA：视觉中间状态为动作预测提供空间依据。图源：<a href="https://arxiv.org/abs/2503.22020">论文原文</a>。</figcaption></figure>
评价时需验证中间视觉是否因果地改善控制，可通过遮蔽、替换或扰动思维链做消融，避免把可视化误当成解释。

## Interleave-VLA

[Interleave-VLA](https://arxiv.org/abs/2505.02152) 在序列中交错图像与文本指令，使长任务可以按阶段更新视觉证据和语言条件。
<figure class="paper-figure"><img src="/blog/images/research/papers/interleave-vla-architecture.webp" alt="Interleave-VLA 图像文本交错指令架构" loading="lazy" decoding="async" /><figcaption>Interleave-VLA：多阶段视觉与语言条件共同驱动操作。图源：<a href="https://arxiv.org/abs/2505.02152">论文原文</a>。</figcaption></figure>
交错上下文适合纠错和人机协作，但上下文长度随执行增长。实际系统需要阶段摘要、关键帧选择和历史淘汰策略。

## SmolVLA

[SmolVLA](https://arxiv.org/abs/2506.01844) 面向低成本硬件，以紧凑 VLM、异步推理和高效动作解码降低部署门槛。
<figure class="paper-figure"><img src="/blog/images/research/papers/smolvla-architecture.webp" alt="SmolVLA 高效视觉语言动作模型" loading="lazy" decoding="async" /><figcaption>SmolVLA：把模型效率与真实机器人控制周期共同设计。图源：<a href="https://arxiv.org/abs/2506.01844">论文原文</a>。</figcaption></figure>
小模型的价值应以端到端延迟、显存、控制频率和单位数据收益衡量，而不只是参数量。

| 方法 | 核心接口 | 适用重点 |
| --- | --- | --- |
| UniVLA / GraspVLA | 潜动作 / 合成动作 | 数据扩展 |
| A0 / OneTwoVLA | 分层 / 快慢路由 | 长任务与实时性 |
| Magma / CoT-VLA | 空间标记 / 视觉推理 | 可解释空间决策 |
| Interleave-VLA / SmolVLA | 交错上下文 / 紧凑策略 | 在线协作与边缘部署 |
