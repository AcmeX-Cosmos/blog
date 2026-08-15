---
title: "Paper Reading: Embodied AI 5 - 高效 6D 抓取检测与候选排序"
date: "2026-08-16T08:08:00+08:00"
description: "聚焦 EconomicGrasp、RNGNet、AnyGrasp、GSNet、HGGD 与 GtG 2.0，梳理抓取区域、候选生成、评分和时序跟踪。"
tags: ["Embodied AI", "6D抓取", "GraspNet", "点云", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/embodied-ai-architecture-map.svg"
references:
  - { title: "EconomicGrasp", meta: "arXiv 2407.08366", url: "https://arxiv.org/abs/2407.08366" }
  - { title: "RNGNet", meta: "arXiv 2406.01767", url: "https://arxiv.org/abs/2406.01767" }
  - { title: "AnyGrasp", meta: "arXiv 2212.08333", url: "https://arxiv.org/abs/2212.08333" }
  - { title: "GSNet", meta: "arXiv 2406.11142", url: "https://arxiv.org/abs/2406.11142" }
  - { title: "HGGD", meta: "arXiv 2403.18546", url: "https://arxiv.org/abs/2403.18546" }
  - { title: "GtG 2.0", meta: "arXiv 2505.02664", url: "https://arxiv.org/abs/2505.02664" }
---

![Embodied AI architecture map](/blog/images/research/embodied-ai-architecture-map.svg)

六自由度抓取系统应拆成可抓区域、姿态候选、质量评分、碰撞过滤与执行验收。本篇选择的论文分别优化监督成本、局部搜索、时序稳定性和候选排序。

## EconomicGrasp
[EconomicGrasp](https://arxiv.org/abs/2407.08366) 通过选择低歧义关键标签和轻量训练管线减少密集监督成本，再用交互抓取头与组合评分聚焦高质量候选。
<figure class="paper-figure"><img src="/blog/images/research/papers/economicgrasp-architecture.webp" alt="EconomicGrasp 经济监督与抓取评分架构" loading="lazy" decoding="async" /><figcaption>EconomicGrasp：降低监督成本并保持候选质量。图源：<a href="https://arxiv.org/abs/2407.08366">论文原文</a>。</figcaption></figure>
训练资源下降不代表部署成本同步下降，仍需测量点云预处理、NMS 和碰撞检测的总延迟。

## RNGNet
[RNGNet](https://arxiv.org/abs/2406.01767) 先预测语义相关抓取区域，再在归一化抓取空间内生成局部六自由度候选，减少对整幅点云的无效搜索。
<figure class="paper-figure"><img src="/blog/images/research/papers/rngnet-architecture.webp" alt="RNGNet 区域感知与归一化抓取空间" loading="lazy" decoding="async" /><figcaption>RNGNet：全局区域定位后执行局部姿态推理。图源：<a href="https://arxiv.org/abs/2406.01767">论文原文</a>。</figcaption></figure>
区域错误会形成不可恢复的级联失败，因此需要保留多区域候选并报告 recall，而不只看最终 AP。

## AnyGrasp
[AnyGrasp](https://arxiv.org/abs/2212.08333) 强调开放场景与视频流中的稳定抓取感知，通过几何先验和跨帧跟踪提升候选连续性。
<figure class="paper-figure"><img src="/blog/images/research/papers/anygrasp-architecture.webp" alt="AnyGrasp 空间时序抓取感知架构" loading="lazy" decoding="async" /><figcaption>AnyGrasp：同时建模单帧几何与跨帧稳定性。图源：<a href="https://arxiv.org/abs/2212.08333">论文原文</a>。</figcaption></figure>
时序平滑必须允许目标突变；执行前应以最新深度重新验证姿态，而不是直接复用历史抓取。

## GSNet
[GSNet](https://arxiv.org/abs/2406.11142) 学习 graspness，将点云中的高潜力区域与视角优先筛出，再进行精细候选回归。
<figure class="paper-figure"><img src="/blog/images/research/papers/gsnet-architecture.webp" alt="GSNet 抓取性发现与候选回归架构" loading="lazy" decoding="async" /><figcaption>GSNet：抓取性作为粗到细搜索的先验。图源：<a href="https://arxiv.org/abs/2406.11142">论文原文</a>。</figcaption></figure>
抓取性分数只描述几何潜力，任务语义、机器人可达性和夹爪宽度需要在下游重新排序。

## HGGD
[HGGD](https://arxiv.org/abs/2403.18546) 在图像空间预测热图，聚合局部点形成抓取区域，再用非均匀锚点采样生成多样候选。
<figure class="paper-figure"><img src="/blog/images/research/papers/hggd-architecture.webp" alt="HGGD 热图引导的六自由度抓取检测" loading="lazy" decoding="async" /><figcaption>HGGD：二维高效热图引导局部三维推理。图源：<a href="https://arxiv.org/abs/2403.18546">论文原文</a>。</figcaption></figure>
二维到三维的映射对深度空洞敏感，应在透明、反光和细小物体上单独评测。

## GtG 2.0
[Grasp the Graph 2.0](https://arxiv.org/abs/2505.02664) 用图神经网络集成对候选之间的几何关系建模，面向拥挤场景提升高精度姿态排序。
<figure class="paper-figure"><img src="/blog/images/research/papers/gtg2-architecture.webp" alt="GtG 2.0 图神经网络抓取候选集成" loading="lazy" decoding="async" /><figcaption>GtG 2.0：候选图关系用于精细评分。图源：<a href="https://arxiv.org/abs/2505.02664">论文原文</a>。</figcaption></figure>
候选关系建模增加精度，也增加图构建和推理延迟。系统选择应以完整抓取周期而不是网络 FPS 为准。

| 阶段 | 代表方法 | 失败检查 |
| --- | --- | --- |
| 区域筛选 | RNGNet / HGGD | 小物体与深度空洞召回 |
| 候选生成 | GSNet / AnyGrasp | 姿态多样性与时序漂移 |
| 候选排序 | EconomicGrasp / GtG 2.0 | 碰撞、可达性与任务适配 |
