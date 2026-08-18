---
title: "Paper Reading: CV 2 - 三维匹配、持续重建与开放世界感知"
date: "2025-06-16"
description: "以定位、尺度与开放词汇接口为线索，评估 MASt3R、CUT3R、Depth Anything V2、UniDepth、FoundationStereo、Florence-2 和 YOLO-World。"
tags: ["CV", "三维视觉", "深度估计", "开放词汇", "论文合集"]
category: "research"
cover: "/blog/images/research/cv-architecture-map.svg"
references:
  - { title: "MASt3R", meta: "arXiv 2406.09756", url: "https://arxiv.org/abs/2406.09756" }
  - { title: "CUT3R", meta: "arXiv 2501.12387", url: "https://arxiv.org/abs/2501.12387" }
  - { title: "Depth Anything V2", meta: "arXiv 2406.09414", url: "https://arxiv.org/abs/2406.09414" }
  - { title: "UniDepth", meta: "arXiv 2403.18913", url: "https://arxiv.org/abs/2403.18913" }
  - { title: "FoundationStereo", meta: "arXiv 2501.09898", url: "https://arxiv.org/abs/2501.09898" }
  - { title: "Florence-2", meta: "arXiv 2311.06242", url: "https://arxiv.org/abs/2311.06242" }
  - { title: "YOLO-World", meta: "arXiv 2401.17270", url: "https://arxiv.org/abs/2401.17270" }
---

![Computer vision architecture map](/blog/images/research/cv-architecture-map.svg)

这篇不按“模型更大、指标更高”的顺序阅读，而从机器人视觉的三个缺口出发：对应关系需要几何约束，深度需要可靠尺度，开放词汇输出需要稳定的结构化接口。每项方法都能补一部分能力，但也会把新的假设带入系统。

## MASt3R
[MASt3R](https://arxiv.org/abs/2406.09756) 在 pointmap 几何表示之外增加局部描述子，使像素对应同时受三维结构和外观特征约束。互惠匹配进一步过滤单向近邻，减少重复纹理中的错误关联。
<figure class="paper-figure"><img src="/blog/images/research/papers/mast3r-architecture.webp" alt="MASt3R 三维点图与密集匹配架构" loading="lazy" decoding="async" /><figcaption>阅读重点：点图与局部特征怎样共同限定跨视图对应。图源：<a href="https://arxiv.org/abs/2406.09756">论文原文</a>。</figcaption></figure>
我会同时测匹配召回、外点率、显存和图像对数量增长后的耗时。短序列精度提升若伴随近二次计算增长，进入长期定位系统后可能得不偿失。

## CUT3R
[CUT3R](https://arxiv.org/abs/2501.12387) 用循环状态逐步吸收新观测，并持续输出同一参考系下的 pointmap。这样无需每次重算全部历史，但过去的估计也会通过隐藏状态长期影响后续重建。
<figure class="paper-figure"><img src="/blog/images/research/papers/cut3r-architecture.webp" alt="CUT3R 持久状态与持续三维重建架构" loading="lazy" decoding="async" /><figcaption>阅读重点：持久状态如何更新并维护统一三维参考系。图源：<a href="https://arxiv.org/abs/2501.12387">论文原文</a>。</figcaption></figure>
长序列测试应包含闭环返回、动态对象和突然遮挡，并观察误差是否随时间单调累积。若系统没有状态重置或全局校正接口，实时性优势可能换来不可恢复的地图漂移。

## Depth Anything V2
[Depth Anything V2](https://arxiv.org/abs/2406.09414) 先用精确合成深度训练大教师，再由教师为海量真实图像产生伪标签，学生模型由此兼顾几何细节与真实域覆盖。数据管线本身是性能来源之一，而非单纯依赖网络结构。
<figure class="paper-figure"><img src="/blog/images/research/papers/depth-anything-v2-architecture.webp" alt="Depth Anything V2 教师学生深度估计架构" loading="lazy" decoding="async" /><figcaption>阅读重点：合成真值如何借助教师模型迁移到真实图像。图源：<a href="https://arxiv.org/abs/2406.09414">论文原文</a>。</figcaption></figure>
其相对深度适合排序和边界理解，但不能直接替代抓取所需的米制距离。使用时要明确尺度恢复方法，并单独验证遮挡边缘、透明表面和相机内参变化。

## UniDepth
[UniDepth](https://arxiv.org/abs/2403.18913) 把相机表示也作为预测对象，使网络在未知内参条件下尝试恢复米制深度。self-promptable camera module 为深度分支提供成像几何条件，降低不同相机之间的分布差异。
<figure class="paper-figure"><img src="/blog/images/research/papers/unidepth-architecture.webp" alt="UniDepth 相机提示与米制深度预测架构" loading="lazy" decoding="async" /><figcaption>阅读重点：相机表示如何约束单目米制深度。图源：<a href="https://arxiv.org/abs/2403.18913">论文原文</a>。</figcaption></figure>
部署前仍需校验相机模型适用范围。广角畸变、滚动快门、裁剪缩放和未知焦距都可能造成系统性尺度偏差，最好用已知尺寸物体建立在线 sanity check。

## FoundationStereo
[FoundationStereo](https://arxiv.org/abs/2501.09898) 依靠大规模合成双目数据训练通用匹配能力，并以基础视觉特征提供单目语义先验。自筛选与 side-tuning 用于减少低质量合成样本和特征域差异，希望在新场景中直接推理。
<figure class="paper-figure"><img src="/blog/images/research/papers/foundationstereo-architecture.webp" alt="FoundationStereo 零样本立体匹配架构" loading="lazy" decoding="async" /><figcaption>阅读重点：合成双目监督与通用视觉先验如何互补。图源：<a href="https://arxiv.org/abs/2501.09898">论文原文</a>。</figcaption></figure>
“零样本”不等于无需相机验收。我会覆盖曝光差、弱纹理、反光、遮挡和左右相机色差，并把标定误差与网络视差误差分开测量。

## Florence-2
[Florence-2](https://arxiv.org/abs/2311.06242) 把描述、检测、指代定位和分割统一成由任务 prompt 控制的序列生成。FLD-5B 提供多类型监督，使一个 seq2seq 模型可以通过输出格式切换视觉任务。
<figure class="paper-figure"><img src="/blog/images/research/papers/florence2-architecture.webp" alt="Florence-2 统一视觉任务序列到序列架构" loading="lazy" decoding="async" /><figcaption>阅读重点：任务提示与输出序列怎样统一多种视觉接口。图源：<a href="https://arxiv.org/abs/2311.06242">论文原文</a>。</figcaption></figure>
机器人侧应把生成文本视为不可信输入：使用严格 schema 解析坐标，检查范围与数量，再进行反归一化和置信度过滤。格式统一减少了模型数量，却没有取消接口验证。

## YOLO-World
[YOLO-World](https://arxiv.org/abs/2401.17270) 将区域特征与文本类别放到实时 YOLO 检测框架中对齐，RepVL-PAN 负责视觉语言融合，区域文本对比目标负责扩展可查询类别。其核心取舍是以较低延迟获得开放词汇能力。
<figure class="paper-figure"><img src="/blog/images/research/papers/yolo-world-architecture.webp" alt="YOLO-World 实时开放词汇检测架构" loading="lazy" decoding="async" /><figcaption>阅读重点：文本类别怎样参与实时多尺度区域预测。图源：<a href="https://arxiv.org/abs/2401.17270">论文原文</a>。</figcaption></figure>
部署时必须固定提示模板并重新标定阈值。同义词、复合短语和长尾对象会改变分数分布，开放词汇也无法自动处理未知物拒识，因此需要目标场景的负样本集。

| 输出能力 | 代表方法 | 接入系统前的检查 |
| --- | --- | --- |
| 对应与重建 | MASt3R / CUT3R | 外点、漂移、回环与状态重置 |
| 深度与尺度 | Depth Anything V2 / UniDepth / FoundationStereo | 米制尺度、标定和传感噪声 |
| 开放视觉接口 | Florence-2 / YOLO-World | schema、提示模板、阈值和拒识 |
