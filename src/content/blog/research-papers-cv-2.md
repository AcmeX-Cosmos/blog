---
title: "Paper Reading: CV 2 - 三维匹配、持续重建与开放世界感知"
date: "2026-08-16T08:02:00+08:00"
description: "从 MASt3R、CUT3R、Depth Anything V2、UniDepth、FoundationStereo、Florence-2 到 YOLO-World，梳理几何视觉与开放词汇感知的统一接口。"
tags: ["CV", "三维视觉", "深度估计", "开放词汇", "论文合集"]
category: "research"
pinned: true
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

CV 1 介绍了 DUSt3R、VGGT、DINO 和基础分割模型。本篇继续追踪三个工程问题：如何让匹配真正利用三维、如何在视频流中持续更新世界状态，以及如何把开放词汇能力压缩到实时检测器。

## MASt3R
[MASt3R](https://arxiv.org/abs/2406.09756) 在 DUSt3R 的 pointmap 表示上增加 dense local feature head，并使用匹配损失和 reciprocal matching 把图像匹配重新定义为三维问题。
<figure class="paper-figure"><img src="/blog/images/research/papers/mast3r-architecture.webp" alt="MASt3R 三维点图与密集匹配架构" loading="lazy" decoding="async" /><figcaption>MASt3R：点图几何与局部特征共同完成匹配。图源：<a href="https://arxiv.org/abs/2406.09756">论文原文</a>。</figcaption></figure>
匹配精度与速度必须一起看；密集特征的二次复杂度会在长序列定位中成为瓶颈。

## CUT3R
[CUT3R](https://arxiv.org/abs/2501.12387) 使用带持久状态的 recurrent Transformer，逐帧更新统一坐标系中的 pointmap，支持视频流和无序照片集合。
<figure class="paper-figure"><img src="/blog/images/research/papers/cut3r-architecture.webp" alt="CUT3R 持久状态与持续三维重建架构" loading="lazy" decoding="async" /><figcaption>CUT3R：持久状态让三维场景随观测连续更新。图源：<a href="https://arxiv.org/abs/2501.12387">论文原文</a>。</figcaption></figure>
持久状态带来速度，也带来错误累积。长期运行要设计回环校正、状态重置和动态物体隔离。

## Depth Anything V2
[Depth Anything V2](https://arxiv.org/abs/2406.09414) 用合成标注替代真实深度标签，扩大教师模型，再以大规模伪标注真实图像训练学生，显著提升单目深度细节与泛化。
<figure class="paper-figure"><img src="/blog/images/research/papers/depth-anything-v2-architecture.webp" alt="Depth Anything V2 教师学生深度估计架构" loading="lazy" decoding="async" /><figcaption>Depth Anything V2：合成监督、教师扩展与伪标签桥接真实域。图源：<a href="https://arxiv.org/abs/2406.09414">论文原文</a>。</figcaption></figure>
相对深度不能直接替代机器人所需的米制深度；相机内参、尺度校准和遮挡边界仍需下游处理。

## UniDepth
[UniDepth](https://arxiv.org/abs/2403.18913) 让模型从单张图像同时预测深度与相机表示，通过 self-promptable camera module 和几何不变损失提升跨域米制深度。
<figure class="paper-figure"><img src="/blog/images/research/papers/unidepth-architecture.webp" alt="UniDepth 相机提示与米制深度预测架构" loading="lazy" decoding="async" /><figcaption>UniDepth：相机提示把深度表征与成像几何解耦。图源：<a href="https://arxiv.org/abs/2403.18913">论文原文</a>。</figcaption></figure>
使用时应验证相机模型假设；广角畸变、滚动快门和未知内参都会改变深度可靠性。

## FoundationStereo
[FoundationStereo](https://arxiv.org/abs/2501.09898) 通过百万级合成双目对、自我筛选和 side-tuning 视觉基础特征，追求无需目标域微调的立体匹配。
<figure class="paper-figure"><img src="/blog/images/research/papers/foundationstereo-architecture.webp" alt="FoundationStereo 零样本立体匹配架构" loading="lazy" decoding="async" /><figcaption>FoundationStereo：合成数据与单目先验共同缩小域差异。图源：<a href="https://arxiv.org/abs/2501.09898">论文原文</a>。</figcaption></figure>
零样本表现取决于合成数据的纹理、曝光和遮挡覆盖；真实相机的噪声模型不能被忽略。

## Florence-2
[Florence-2](https://arxiv.org/abs/2311.06242) 采用统一 prompt-to-sequence 接口完成 caption、检测、grounding 和分割，并以 FLD-5B 多任务标注训练 seq2seq 模型。
<figure class="paper-figure"><img src="/blog/images/research/papers/florence2-architecture.webp" alt="Florence-2 统一视觉任务序列到序列架构" loading="lazy" decoding="async" /><figcaption>Florence-2：任务指令统一多种视觉输出。图源：<a href="https://arxiv.org/abs/2311.06242">论文原文</a>。</figcaption></figure>
统一接口便于机器人系统组合，但文本输出仍需严格解析、坐标反归一化和置信度过滤。

## YOLO-World
[YOLO-World](https://arxiv.org/abs/2401.17270) 在 YOLO 的实时骨干上加入 RepVL-PAN 和 region-text contrastive loss，实现开放词汇检测。
<figure class="paper-figure"><img src="/blog/images/research/papers/yolo-world-architecture.webp" alt="YOLO-World 实时开放词汇检测架构" loading="lazy" decoding="async" /><figcaption>YOLO-World：视觉区域与文本类别在实时检测器中交互。图源：<a href="https://arxiv.org/abs/2401.17270">论文原文</a>。</figcaption></figure>
开放词汇不等于开放世界可靠性，类别短语、阈值、重复框和长尾对象都要在目标场景重新校准。

| 任务 | 表征 | 工程接口 |
| --- | --- | --- |
| 匹配 / 重建 | pointmap + feature / persistent state | 位姿、回环与状态重置 |
| 深度 / 双目 | 相机提示 / cost volume | 尺度、内参与噪声 |
| 开放视觉 | prompt-to-sequence / region-text | 解析、阈值与坐标回投 |
