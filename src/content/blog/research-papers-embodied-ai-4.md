---
title: "Paper Reading: Embodied AI 4 - 四维表征、空间轨迹与跨本体操作"
date: "2026-08-16T08:07:00+08:00"
description: "精选 4D-VLA、D(R,O) Grasp、NavDP、SpatialVLA、TraceVLA 与 Spatial Traces，研究空间时序信息如何进入策略。"
tags: ["Embodied AI", "空间推理", "跨本体", "机器人导航", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/embodied-ai-architecture-map.svg"
references:
  - { title: "4D-VLA", meta: "arXiv 2506.22242", url: "https://arxiv.org/abs/2506.22242" }
  - { title: "D(R,O) Grasp", meta: "arXiv 2410.01702", url: "https://arxiv.org/abs/2410.01702" }
  - { title: "NavDP", meta: "arXiv 2505.08712", url: "https://arxiv.org/abs/2505.08712" }
  - { title: "SpatialVLA", meta: "arXiv 2501.15830", url: "https://arxiv.org/abs/2501.15830" }
  - { title: "TraceVLA", meta: "arXiv 2412.10345", url: "https://arxiv.org/abs/2412.10345" }
  - { title: "Spatial Traces", meta: "arXiv 2508.09032", url: "https://arxiv.org/abs/2508.09032" }
---

![Embodied AI architecture map](/blog/images/research/embodied-ai-architecture-map.svg)

本篇围绕空间信息的表示层级展开：四维场景 token、机器人与物体的统一交互表示、导航扩散策略、三维位置编码，以及可视轨迹提示。

## 4D-VLA
[4D-VLA](https://arxiv.org/abs/2506.22242) 通过跨场景校准学习时空表征，使不同视角和时刻的几何变化进入 VLA 预训练。
<figure class="paper-figure"><img src="/blog/images/research/papers/4d-vla-architecture.webp" alt="4D-VLA 跨场景时空校准架构" loading="lazy" decoding="async" /><figcaption>4D-VLA：跨场景校准连接视觉时序与动作。图源：<a href="https://arxiv.org/abs/2506.22242">论文原文</a>。</figcaption></figure>
四维一致性依赖相机位姿、时间同步与动态对象分离，训练前的数据校准质量会直接决定上限。

## D(R,O) Grasp
[$\mathcal{D(R,O)}$ Grasp](https://arxiv.org/abs/2410.01702) 用统一表示描述 robot、object 与两者关系，面向不同手型和跨本体灵巧抓取。
<figure class="paper-figure"><img src="/blog/images/research/papers/dro-grasp-architecture.webp" alt="DRO Grasp 机器人对象交互统一表示" loading="lazy" decoding="async" /><figcaption>D(R,O) Grasp：把手型约束显式放入对象交互表示。图源：<a href="https://arxiv.org/abs/2410.01702">论文原文</a>。</figcaption></figure>
跨手型迁移不能只看几何包围，关节限位、自碰撞、摩擦和力闭合仍需独立验证。

## NavDP
[NavDP](https://arxiv.org/abs/2505.08712) 在训练时用特权地图和状态指导导航 diffusion policy，部署时仅依赖可获得观测，实现 sim-to-real 蒸馏。
<figure class="paper-figure"><img src="/blog/images/research/papers/navdp-architecture.webp" alt="NavDP 特权信息引导的导航扩散策略" loading="lazy" decoding="async" /><figcaption>NavDP：训练期特权信息指导可部署策略。图源：<a href="https://arxiv.org/abs/2505.08712">论文原文</a>。</figcaption></figure>
必须审计评测阶段是否残留特权信号，并把碰撞、停滞和到达误差分开统计。

## SpatialVLA
[SpatialVLA](https://arxiv.org/abs/2501.15830) 引入面向三维空间的 token 与位置表示，让模型显式学习对象和动作之间的几何关系。
<figure class="paper-figure"><img src="/blog/images/research/papers/spatialvla-architecture.webp" alt="SpatialVLA 三维空间 token 与动作预测" loading="lazy" decoding="async" /><figcaption>SpatialVLA：三维位置编码为动作提供几何条件。图源：<a href="https://arxiv.org/abs/2501.15830">论文原文</a>。</figcaption></figure>
空间 token 的精度受深度、标定和坐标系定义约束；跨数据集训练前必须统一轴向、单位与动作基准系。

## TraceVLA
[TraceVLA](https://arxiv.org/abs/2412.10345) 把视觉轨迹作为 prompt，增强通用策略对目标移动方向和动作时间结构的理解。
<figure class="paper-figure"><img src="/blog/images/research/papers/tracevla-architecture.webp" alt="TraceVLA 视觉轨迹提示策略" loading="lazy" decoding="async" /><figcaption>TraceVLA：轨迹提示压缩空间与时间意图。图源：<a href="https://arxiv.org/abs/2412.10345">论文原文</a>。</figcaption></figure>
轨迹是意图而非精确控制命令，应与实时避障和末端反馈组合，避免盲目追随过期提示。

## Spatial Traces
[Spatial Traces](https://arxiv.org/abs/2508.09032) 将空间时序轨迹作为训练中间表示，帮助 VLA 理解动作如何在图像空间展开。
<figure class="paper-figure"><img src="/blog/images/research/papers/spatial-traces-architecture.webp" alt="Spatial Traces 空间时序监督架构" loading="lazy" decoding="async" /><figcaption>Spatial Traces：用可视运动痕迹监督空间时序理解。图源：<a href="https://arxiv.org/abs/2508.09032">论文原文</a>。</figcaption></figure>
与 TraceVLA 类似，其价值在中间监督；真正落地仍要把二维轨迹回投为可达的六自由度目标。
