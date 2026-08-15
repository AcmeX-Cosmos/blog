---
title: "Paper Reading: LLM 2 - 多模态扩散语言模型与统一后训练"
date: "2026-08-16T08:01:00+08:00"
description: "深读 MMaDA 的统一扩散架构、跨模态 Chain-of-Thought 与 UniGRPO，理解扩散式语言模型如何连接推理、理解和图像生成。"
tags: ["LLM", "多模态", "扩散模型", "模型对齐", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/llm-architecture-map.svg"
references:
  - { title: "MMaDA: Multimodal Large Diffusion Language Models", meta: "arXiv 2505.15809 · 2025", url: "https://arxiv.org/abs/2505.15809" }
---

![LLM architecture evolution map](/blog/images/research/llm-architecture-map.svg)

LLM 1 以自回归 Transformer、MoE、状态空间模型和 RL 对齐为主线。本篇只讨论一篇但值得单独精读的工作：MMaDA 试图用一个 modality-agnostic diffusion backbone 同时处理文本推理、多模态理解和文本到图像生成，并用统一的强化学习后训练连接这些能力。

## MMaDA

[MMaDA: Multimodal Large Diffusion Language Models](https://arxiv.org/abs/2505.15809) 的核心不是把几个模型拼在一起，而是让不同模态共享扩散式概率建模。文本 token、视觉 token 和噪声状态进入同一 Transformer 计算图，通过去噪目标恢复被扰动的序列或图像表示。

<figure class="paper-figure"><img src="/blog/images/research/papers/mmada-architecture.webp" alt="MMaDA 统一多模态扩散语言模型架构" loading="lazy" decoding="async" /><figcaption>MMaDA：统一扩散骨干连接文本推理、多模态理解与图像生成。图源：<a href="https://arxiv.org/abs/2505.15809">论文原文</a>。</figcaption></figure>

### 统一概率接口

自回归模型按从左到右的条件分布生成，而扩散模型在多个时间步逐渐还原被遮蔽或加噪的状态。统一接口的好处是文本和图像可以共享训练与推理抽象，代价是采样步数、噪声调度和离散文本表示必须协调。

### 跨模态 Chain-of-Thought

MMaDA 使用混合长 CoT 微调，让文本推理与视觉推理共享结构化的中间过程。对于机器人或视觉代理，这种设计启发我们把“观察、空间判断、行动理由”放到同一可审计轨迹中，但中间过程仍不能替代外部几何验证。

### UniGRPO

UniGRPO 将 policy-gradient 后训练推广到扩散模型，用不同 reward model 同时评价文本答案、视觉理解和图像生成。实现时要明确 reward 的时间步归因：最终样本质量并不能直接告诉我们哪一步去噪导致失败。

### 工程判断

MMaDA 的统一性带来三类实际约束：扩散采样延迟可能高于一次自回归解码；多模态 batch 的 token 与分辨率差异会造成显存峰值；跨任务 reward 可能互相牵制。评估不能只看总分，应按文本推理、视觉问答、图像生成和采样成本分别报告。

| 组件 | 解决的问题 | 复现检查 |
| --- | --- | --- |
| 统一扩散骨干 | 模态专用组件过多 | token 化与噪声调度 |
| 混合 CoT | 推理过程割裂 | 中间过程可验证性 |
| UniGRPO | 扩散模型后训练 | reward 归因与稳定性 |

MMaDA 适合作为理解“统一多模态模型”边界的案例：共享架构并不自动带来共享能力，数据配比、模态接口、采样预算和评价函数才决定统一是否真正有效。
