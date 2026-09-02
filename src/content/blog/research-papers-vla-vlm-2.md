---
title: "Paper Reading: VLA / VLM 2 - 潜动作、分层推理与高效策略"
date: "2026-01-18"
description: "围绕数据利用率、策略分层与在线延迟，评估 UniVLA、GraspVLA、A0、OneTwoVLA、Magma、CoT-VLA、Interleave-VLA 和 SmolVLA。"
tags: ["VLA", "VLM", "多模态", "机器人基础模型", "论文合集"]
category: "research"
cover: "/images/research/vla-vlm-architecture-map.svg"
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

![VLA and VLM architecture map](/images/research/vla-vlm-architecture-map.svg)

VLA 的困难并不只在模型容量，而在可用数据和控制数据之间存在巨大鸿沟：网络视频没有机器人动作，合成轨迹缺少真实接触，强推理模型又往往达不到控制频率。本篇以这三类矛盾为线索，判断八项工作分别把复杂度转移到了哪里。

## UniVLA

[UniVLA](https://arxiv.org/abs/2505.06111) 从相邻画面的任务相关变化中学习潜动作，使公开视频可以在没有关节命令的情况下参与预训练。接入目标机器人时，再由本体专用解码器把共享潜变量翻译成真实控制量。
<figure class="paper-figure"><img src="/images/research/papers/univla-architecture.webp" alt="UniVLA 潜动作学习与跨本体解码架构" loading="lazy" decoding="async" /><figcaption>阅读重点：共享视觉变化与本体动作解码器之间的接口。图源：<a href="https://arxiv.org/abs/2505.06111">论文原文</a>。</figcaption></figure>
潜变量能够扩大数据来源，却没有自动满足动力学约束。复现实验应分别测潜动作对未来状态的解释力、解码动作误差和闭环成功率，并检查相同潜动作在不同本体上是否对应一致的任务语义。

## GraspVLA

[GraspVLA](https://arxiv.org/abs/2505.03233) 依靠大规模合成动作数据建立对象、语言目标和抓取动作之间的对应，再用真实数据完成策略校准。这条路线把稀缺的真机采集从“学习全部能力”转为“修正仿真偏差”。
<figure class="paper-figure"><img src="/images/research/papers/graspvla-architecture.webp" alt="GraspVLA 合成抓取数据预训练架构" loading="lazy" decoding="async" /><figcaption>阅读重点：合成抓取先验在哪个阶段被真实轨迹校正。图源：<a href="https://arxiv.org/abs/2505.03233">论文原文</a>。</figcaption></figure>
我会按材质、深度噪声、遮挡、接触状态和执行器误差建立域差异矩阵，观察少量真实数据究竟修正了哪一类问题。只增加真实样本而不定位偏差，难以判断后续数据预算应投向哪里。

## A0

[A0](https://arxiv.org/abs/2504.12636) 将高层可供性判断与低层动作生成分开。前者确定当前阶段及操作区域，后者只在收缩后的空间中控制，从而避免一个端到端策略同时承担开放语义和高精度运动。
<figure class="paper-figure"><img src="/images/research/papers/a0-architecture.webp" alt="A0 可供性感知分层机器人策略" loading="lazy" decoding="async" /><figcaption>阅读重点：高层区域约束如何影响低层动作分布。图源：<a href="https://arxiv.org/abs/2504.12636">论文原文</a>。</figcaption></figure>
分层系统的风险集中在切换逻辑。高层置信度过高会把低层锁在错误区域，因此需要超时、观测不一致和执行失败三类退出条件，并单独统计各层造成的失败比例。

## OneTwoVLA

[OneTwoVLA](https://arxiv.org/abs/2505.11917) 为策略提供快慢两条路径：熟悉且确定的状态直接产生动作，歧义场景或长程决策才启用更完整的推理。它把计算量变成按需资源，而不是每一步固定支付。
<figure class="paper-figure"><img src="/images/research/papers/onetwovla-architecture.webp" alt="OneTwoVLA 自适应快慢推理架构" loading="lazy" decoding="async" /><figcaption>阅读重点：难度估计如何在快速控制与完整推理之间路由。图源：<a href="https://arxiv.org/abs/2505.11917">论文原文</a>。</figcaption></figure>
路由错误比任一分支的平均精度更关键。我会构造“看似简单但需要推理”的反例，记录错误走快路径的比例、额外延迟及失败后能否切换到慢路径恢复。

## Magma

[Magma](https://arxiv.org/abs/2502.13130) 用 set-of-mark 标出可交互实体，再以 trace-of-mark 表达随时间变化的运动，使 UI 操作、导航和机器人控制共享一套视觉指代接口。显式标记降低了语言描述空间位置的歧义。
<figure class="paper-figure"><img src="/images/research/papers/magma-architecture.webp" alt="Magma 多模态智能体空间与动作标记架构" loading="lazy" decoding="async" /><figcaption>阅读重点：实体标记与运动痕迹如何形成跨任务动作接口。图源：<a href="https://arxiv.org/abs/2502.13130">论文原文</a>。</figcaption></figure>
这套接口依赖稳定的实体身份。遮挡、同类对象交叉和检测编号变化都会污染后续轨迹，因此系统需要跨帧身份置信度以及在不确定时重新确认目标的机制。

## CoT-VLA

[CoT-VLA](https://arxiv.org/abs/2503.22020) 在动作之前生成带空间信息的视觉中间状态，让推理不仅存在于文字中，也保留对象位置与运动线索。中间结果因而可以被观察，但仍需证明它参与了动作决策。
<figure class="paper-figure"><img src="/images/research/papers/cot-vla-architecture.webp" alt="CoT-VLA 视觉思维链与动作生成架构" loading="lazy" decoding="async" /><figcaption>阅读重点：可视中间状态是否为动作头提供因果信息。图源：<a href="https://arxiv.org/abs/2503.22020">论文原文</a>。</figcaption></figure>
验证方法是对中间视觉做遮蔽、交换和定向扰动，再测动作是否同步变化。若策略忽略这些改动，所谓思维链更接近展示层，而不是可用于调试的决策依据。

## Interleave-VLA

[Interleave-VLA](https://arxiv.org/abs/2505.02152) 允许图像证据与语言条件在执行序列中多次交替出现，因此操作者可以中途补充目标，策略也能在阶段边界读取新的场景状态，而不必把长任务压缩成单次输入。
<figure class="paper-figure"><img src="/images/research/papers/interleave-vla-architecture.webp" alt="Interleave-VLA 图像文本交错指令架构" loading="lazy" decoding="async" /><figcaption>阅读重点：多轮视觉与指令怎样更新长任务的策略条件。图源：<a href="https://arxiv.org/abs/2505.02152">论文原文</a>。</figcaption></figure>
执行越久，上下文越大，旧观测也越可能误导当前动作。工程实现需要关键帧选择、阶段摘要和历史淘汰规则，并验证压缩后是否仍保留失败恢复所需的信息。

## SmolVLA

[SmolVLA](https://arxiv.org/abs/2506.01844) 从低成本设备的约束出发，将紧凑视觉语言模型、异步推理和动作解码共同设计。目标不是单纯压缩参数，而是让感知推理与机器人控制在有限算力上持续并行。
<figure class="paper-figure"><img src="/images/research/papers/smolvla-architecture.webp" alt="SmolVLA 高效视觉语言动作模型" loading="lazy" decoding="async" /><figcaption>阅读重点：异步模型输出如何满足真实控制循环的时延要求。图源：<a href="https://arxiv.org/abs/2506.01844">论文原文</a>。</figcaption></figure>
评测应提供端到端 P50/P95 延迟、峰值显存、持续控制频率和观测到动作的新鲜度。参数量少不保证实时，异步队列过长同样会让动作建立在过期画面上。

| 工程矛盾 | 对应方法 | 建议优先验证 |
| --- | --- | --- |
| 视频多、动作少 | UniVLA / GraspVLA | 潜动作可执行性与仿真偏差 |
| 语义慢、控制快 | A0 / OneTwoVLA | 切换错误与恢复机制 |
| 语言空间歧义 | Magma / CoT-VLA | 实体身份与中间状态因果性 |
| 长上下文与边缘算力 | Interleave-VLA / SmolVLA | 信息淘汰与尾延迟 |
