---
title: "Paper Reading: CV 3 - 自监督密集特征、概念分割与三维生成"
date: "2026-08-16T08:03:00+08:00"
description: "精选 DINOv3、SAM 3、SAM 3D 与 V-JEPA 2，讨论密集视觉表征、概念级视频分割、单图三维生成和世界模型规划。"
tags: ["CV", "视觉基础模型", "三维重建", "视频理解", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/cv-architecture-map.svg"
references:
  - { title: "DINOv3", meta: "arXiv 2508.10104", url: "https://arxiv.org/abs/2508.10104" }
  - { title: "SAM 3", meta: "arXiv 2511.16719", url: "https://arxiv.org/abs/2511.16719" }
  - { title: "SAM 3D", meta: "arXiv 2511.16624", url: "https://arxiv.org/abs/2511.16624" }
  - { title: "V-JEPA 2", meta: "arXiv 2506.09985", url: "https://arxiv.org/abs/2506.09985" }
---

![Computer vision architecture map](/blog/images/research/cv-architecture-map.svg)

这四篇代表视觉基础模型从“强特征”走向“可交互世界模型”：DINOv3 关注长训练中的密集特征退化，SAM 3 让概念提示覆盖检测、分割和跟踪，SAM 3D 把单图对象提升为几何、纹理和布局，V-JEPA 2 则以视频预测服务物理规划。

## DINOv3
[DINOv3](https://arxiv.org/abs/2508.10104) 延续自蒸馏路线，并用 Gram anchoring 稳定长训练中的 dense feature map，再通过后处理适配不同分辨率、模型大小和文本对齐。
<figure class="paper-figure"><img src="/blog/images/research/papers/dinov3-architecture.webp" alt="DINOv3 密集视觉特征与 Gram anchoring" loading="lazy" decoding="async" /><figcaption>DINOv3：规模化自监督训练与密集特征稳定化。图源：<a href="https://arxiv.org/abs/2508.10104">论文原文</a>。</figcaption></figure>
对机器人视觉，dense token 的空间稳定性通常比单一分类分数更重要，应测试跨尺度、跨视角和点级对应。

## SAM 3
[SAM 3](https://arxiv.org/abs/2511.16719) 把 prompt 扩展为概念短语、图像示例或二者组合，统一完成概念检测、实例分割和视频跟踪；presence head 将“概念是否存在”和“位置在哪里”分开。
<figure class="paper-figure"><img src="/blog/images/research/papers/sam3-architecture.webp" alt="SAM 3 概念提示分割与视频跟踪架构" loading="lazy" decoding="async" /><figcaption>SAM 3：概念提示驱动检测、分割和时序身份。图源：<a href="https://arxiv.org/abs/2511.16719">论文原文</a>。</figcaption></figure>
这使开放词汇感知更贴近机器人指令，但 hard negative、实例身份和遮挡恢复仍需按场景验收。

## SAM 3D
[SAM 3D](https://arxiv.org/abs/2511.16624) 从单张图像生成对象几何、纹理和布局，借助合成预训练与真实对齐突破三维标注稀缺。
<figure class="paper-figure"><img src="/blog/images/research/papers/sam3d-architecture.webp" alt="SAM 3D 单图对象几何纹理与布局生成" loading="lazy" decoding="async" /><figcaption>SAM 3D：从视觉对象到可用三维资产。图源：<a href="https://arxiv.org/abs/2511.16624">论文原文</a>。</figcaption></figure>
生成模型输出的是视觉上合理的候选，不是自动可碰撞的仿真资产；部署前仍需尺度、拓扑、碰撞体和材质检查。

## V-JEPA 2
[V-JEPA 2](https://arxiv.org/abs/2506.09985) 用 joint-embedding predictive architecture 从海量视频学习动作无关的世界表示，再用少量机器人视频训练 latent action-conditioned world model。
<figure class="paper-figure"><img src="/blog/images/research/papers/vjepa2-architecture.webp" alt="V-JEPA 2 视频预测与潜动作规划架构" loading="lazy" decoding="async" /><figcaption>V-JEPA 2：视频世界模型连接理解、预测与规划。图源：<a href="https://arxiv.org/abs/2506.09985">论文原文</a>。</figcaption></figure>
它的关键不是直接生成像素，而是在表示空间预测未来并以图像目标规划。真实部署仍要校验模型预测与接触动力学的偏差。

## Reading Notes

视觉基础模型的迁移边界可以这样记录：特征是否保持空间对应，提示是否能表达对象实例，三维输出是否满足几何和物理约束，视频预测是否能支持反事实规划。四个问题分别对应感知、交互、资产和世界模型层。
