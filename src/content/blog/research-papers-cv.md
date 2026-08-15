---
title: "Paper Reading: CV 视觉表征、三维感知与生成式重建"
date: "2026-08-11"
description: "从 CNN、ViT、自监督学习到开放词汇检测、可提示分割、点云 Transformer、深度估计、三维重建和视频预测，系统梳理 CV 主流论文。"
tags: ["CV", "计算机视觉", "三维视觉", "视觉表征", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/cv-architecture-map.svg"
references:
  - title: "Deep Residual Learning for Image Recognition"
    meta: "He et al. · CVPR 2016"
    url: "https://arxiv.org/abs/1512.03385"
  - title: "An Image is Worth 16x16 Words"
    meta: "Dosovitskiy et al. · ICLR 2021"
    url: "https://arxiv.org/abs/2010.11929"
  - title: "DINOv2"
    meta: "Oquab et al. · TMLR 2024"
    url: "https://arxiv.org/abs/2304.07193"
  - title: "Segment Anything"
    meta: "Kirillov et al. · ICCV 2023"
    url: "https://arxiv.org/abs/2304.02643"
  - title: "DUSt3R"
    meta: "Wang et al. · CVPR 2024"
    url: "https://arxiv.org/abs/2312.14132"
---

![Computer vision architecture map](/blog/images/research/cv-architecture-map.svg)

*本站原创整理图：按监督骨干、自监督表征、开放世界感知和三维几何组织代表模型。*

## AlexNet

[ImageNet Classification with Deep Convolutional Neural Networks](https://arxiv.org/abs/1207.0580) 用深层 CNN 在 ImageNet 上显著超过传统视觉方法。网络由卷积、ReLU、局部响应归一化、池化和全连接层组成，并使用两张 GPU 训练。

AlexNet 的关键不只在深度，还包括 ReLU 替代饱和激活、数据增强、dropout 和 GPU 计算。它建立了“大数据 + 可训练特征 + 端到端优化”的现代视觉范式。

阅读时应计算每层特征图尺寸、感受野与参数量。早期大步长卷积快速降低分辨率，适合分类，却会损失密集预测所需的精细空间信息。

## VGG

[Very Deep Convolutional Networks for Large-Scale Image Recognition](https://arxiv.org/abs/1409.1556) 用连续 $3\times3$ 卷积构建规则而深的网络。两个 $3\times3$ 卷积具有接近 $5\times5$ 的感受野，却引入更多非线性并减少参数。

VGG 的结构高度统一：同一 stage 保持通道数，池化后分辨率减半、通道增加。这种简单规则使网络易于理解和迁移，VGG 特征也长期用于检测、分割和感知损失。

代价是计算和参数量巨大，尤其全连接层。VGG 适合学习卷积层级表示，但不是现代部署的高效选择。

## ResNet

[Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385) 引入残差块

<figure class="paper-figure">
  <img src="/blog/images/research/papers/resnet-architecture.webp" alt="ResNet 残差块与普通深层网络对比" loading="lazy" decoding="async" />
  <figcaption>ResNet：shortcut 让残差分支学习相对输入的修正。图源：<a href="https://arxiv.org/abs/1512.03385">论文原文</a>。</figcaption>
</figure>

$$
y=F(x,W)+x,
$$

让网络学习相对恒等映射的残差。shortcut 为梯度提供直接路径，显著缓解深层网络退化。

BasicBlock 使用两个 $3\times3$ 卷积，Bottleneck 使用 $1\times1$ 降维、$3\times3$ 处理、$1\times1$ 升维。若尺寸或通道变化，shortcut 使用投影匹配。

ResNet 的思想超越 CNN，残差连接成为 Transformer 和扩散模型的基本结构。学习时应区分优化退化与过拟合：更深普通网络训练误差更高，是优化问题而非泛化问题。

## ViT

[An Image is Worth 16x16 Words](https://arxiv.org/abs/2010.11929) 将图像切成 patch，并把每个 patch 线性投影成 token。加入位置 embedding 与 `[CLS]` token 后，序列进入标准 Transformer encoder。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/vit-architecture.webp" alt="Vision Transformer 图像分块与编码器架构" loading="lazy" decoding="async" />
  <figcaption>ViT：图像 patch 被映射为序列 token，再由标准 Transformer encoder 建模。图源：<a href="https://arxiv.org/abs/2010.11929">论文原文</a>。</figcaption>
</figure>

若图像大小为 $H\times W$、patch 为 $P\times P$，token 数为 $N=HW/P^2$，self-attention 复杂度随 $N^2$ 增长。减小 patch 能保留细节，但会快速增加计算。

ViT 缺少卷积的局部和平移先验，因此在小数据上不一定占优；大规模预训练后，全局建模和可扩展性带来明显收益。阅读时应重点比较数据规模、patch size 和预训练方式。

## MAE

[Masked Autoencoders Are Scalable Vision Learners](https://arxiv.org/abs/2111.06377) 随机遮盖高比例 patch，仅把可见 token 输入大型 encoder，再用轻量 decoder 重建像素。非对称结构避免在 encoder 上浪费大量遮盖 token 计算。

重建损失只在 masked patch 上计算。75% 左右高遮盖率迫使模型利用全局结构，而不是从邻近像素做低级插值。

MAE 证明像素重建也能产生强可迁移表示，但重建目标可能过度关注纹理。学习时应比较 mask ratio、decoder 容量、像素归一化和 fine-tuning/linear probing 差异。

## DINO

[Emerging Properties in Self-Supervised Vision Transformers](https://arxiv.org/abs/2104.14294) 使用 teacher-student 自蒸馏。student 预测不同 crop 的 teacher 输出，teacher 参数由 student 的指数移动平均更新，不依赖标签或负样本。

为防止输出坍塌，DINO 对 teacher logits 做 centering 和 sharpening。multi-crop 策略让全局视图与局部视图保持语义一致。

ViT 的自监督 attention 中出现对象分割结构，是 DINO 的重要观察。模型只用图像级目标，却学习到密集对象边界，说明自监督目标可以产生超出分类标签的空间表征。

## DINOv2

[DINOv2: Learning Robust Visual Features without Supervision](https://arxiv.org/abs/2304.07193) 将 DINO 路线扩展到更大、经过筛选的数据，并组合图像级蒸馏、masked patch 目标、KoLeo regularization 和高效训练工程。

DINOv2 强调通用 frozen features：同一个 backbone 可用于分类、深度、分割和图像检索。训练数据经过自监督相似度去重与平衡，说明数据策展与架构同样重要。

阅读时应关注 patch-level 与 `[CLS]` 表示的不同用途。全局检索依赖聚合语义，密集预测依赖空间 token，不能只用一个 benchmark 判断表示质量。

## Grounding DINO

[Grounding DINO: Marrying DINO with Grounded Pre-Training for Open-Set Object Detection](https://arxiv.org/abs/2303.05499) 将 DETR 式检测器与文本编码器结合，输入任意类别短语并输出匹配框。模型在多个检测与 grounding 数据集上联合训练，突破固定类别分类头。

文本 token 参与 feature enhancer、language-guided query selection 和 cross-modality decoder。object query 不再只对应固定类别，而与文本短语动态匹配。

开放词汇检测的难点是语言歧义和长尾概念。评价应同时看框定位和 phrase grounding，不能把正确类别但错误实例视为成功。

## Segment Anything

[Segment Anything](https://arxiv.org/abs/2304.02643) 建立 promptable segmentation。系统由大型 image encoder、prompt encoder 和轻量 mask decoder 构成。图像 embedding 可预计算，不同点、框或粗 mask prompt 能快速产生分割结果。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/sam-architecture.webp" alt="Segment Anything 图像编码、提示编码与掩码解码架构" loading="lazy" decoding="async" />
  <figcaption>SAM：图像编码器、提示编码器与轻量掩码解码器相互解耦。图源：<a href="https://arxiv.org/abs/2304.02643">论文原文</a>。</figcaption>
</figure>

对于歧义 prompt，模型输出多个候选 mask 及预测 IoU。训练数据通过模型辅助标注的数据引擎迭代扩大，最终形成 SA-1B 大规模 mask 数据集。

SAM 的目标是“给定 prompt 分割对象”，不是自动识别语义类别。学习时应区分 prompt 质量、mask 质量与类别判断，并分析细小物体、透明物体和边界区域的失败。

## SAM 2

[SAM 2: Segment Anything in Images and Videos](https://arxiv.org/abs/2408.00714) 将可提示分割扩展到视频。模型引入 streaming memory，把历史帧的 mask 与特征编码到 memory bank，当前帧通过 memory attention 读取对象状态。

图像可视为单帧视频，因此同一架构支持图片与视频。用户可以在任意帧添加点或框纠正，修正信息继续传播到后续帧。

SAM 2 的关键问题是时序身份保持。遮挡、相似对象交叉和长时间消失会污染 memory。阅读时应关注 memory 选择、对象 pointer 和纠错传播机制。

## PointNet

[PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation](https://arxiv.org/abs/1612.00593) 直接处理无序点集。每个点经共享 MLP 编码，再通过对称 max pooling 聚合全局特征：

<figure class="paper-figure">
  <img src="/blog/images/research/papers/pointnet-architecture.webp" alt="PointNet 点级共享网络与对称聚合架构" loading="lazy" decoding="async" />
  <figcaption>PointNet：共享点特征提取与对称池化共同保证排列不变性。图源：<a href="https://arxiv.org/abs/1612.00593">论文原文</a>。</figcaption>
</figure>

$$
f(\{x_i\})=\gamma\left(\max_i h(x_i)\right).
$$

对称函数保证输入点顺序变化不影响输出。T-Net 学习输入与特征空间对齐，提高几何变换鲁棒性。

PointNet 简洁但缺少局部邻域建模。max pooling 只保留少量关键点，细粒度几何关系需要后续结构补充。

## PointNet++

[PointNet++: Deep Hierarchical Feature Learning on Point Sets in a Metric Space](https://arxiv.org/abs/1706.02413) 引入层级 set abstraction。每层先用 farthest point sampling 选择中心，再用半径查询形成局部邻域，最后用小型 PointNet 聚合局部特征。

多层结构逐步扩大感受野，类似 CNN 从边缘到语义的层级。Multi-Scale Grouping 使用多个半径处理非均匀采样密度，Feature Propagation 则把稀疏高层特征插值回原始点。

学习时应理解采样、分组与聚合三步的计算代价。点数、半径和邻居上限会共同决定细节、显存和速度。

## OpenScene

[OpenScene: 3D Scene Understanding with Open Vocabularies](https://arxiv.org/abs/2211.15654) 把二维开放词汇视觉特征蒸馏到三维点。多视角图像经 CLIP 类模型产生 dense feature，再通过相机位姿投影并融合到 3D 点云。

训练后的 3D 网络可以直接输出与文本 embedding 对齐的特征，从而用任意文本查询三维场景。它避免固定语义类别，但性能依赖二维特征质量、几何配准和视角覆盖。

阅读重点是 2D-3D 对应和特征融合。开放词汇能力来自文本对齐，三维一致性则来自多视角几何，两部分需要分别评价。

## DUSt3R

[DUSt3R: Geometric 3D Vision Made Easy](https://arxiv.org/abs/2312.14132) 将两幅图像输入双分支 ViT encoder 与交叉 decoder，直接预测每幅图在第一相机坐标系中的 pointmap 及置信度。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/dust3r-architecture.webp" alt="DUSt3R 双图像编码与点图回归架构" loading="lazy" decoding="async" />
  <figcaption>DUSt3R：双视图特征交互后直接回归统一坐标系中的 pointmap。图源：<a href="https://arxiv.org/abs/2312.14132">论文原文</a>。</figcaption>
</figure>

传统几何管线依赖特征匹配、本质矩阵、三角化和 bundle adjustment；DUSt3R 用统一 pointmap 回归吸收这些步骤，并能处理内参未知或视角变化大的图像对。

多图重建仍需全局对齐不同图像对的 pointmap。学习时应比较它与经典 SfM 的坐标、尺度、置信度和全局优化，避免把“端到端”理解成不需要几何约束。

## VGGT

[VGGT: Visual Geometry Grounded Transformer](https://arxiv.org/abs/2503.11651) 用一个前馈 Transformer 从单张或多张图像联合预测相机、深度、pointmap 和点轨迹。模型在共享 token 表示上设置多个几何 head，统一传统上分离的任务。

交替 frame attention 与 global attention 在单帧局部结构和跨帧关系之间交换信息。相机 token、patch token 与 track token 分别承载不同几何输出。

VGGT 代表通用几何基础模型路线。阅读时应检查尺度约定、输入帧数扩展、相机预测与 pointmap 的一致性，以及是否仍需要后端优化。

## 3D Gaussian Splatting

[3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://arxiv.org/abs/2308.04079) 用一组可优化三维高斯显式表示场景。每个高斯包含位置、协方差、透明度和球谐颜色，通过可微 splatting 投影到图像。

训练从 SfM 稀疏点初始化，并交替优化参数、克隆高梯度高斯、分裂大高斯和删除低透明度高斯。显式表示支持实时渲染，避免 NeRF 大量逐像素网络查询。

3DGS 强于新视角合成，但几何表面并非直接显式 mesh。评价应区分渲染质量、深度质量、存储量和动态场景能力。

## Depth Anything

[Depth Anything](https://arxiv.org/abs/2401.10891) 通过大规模无标签图像与伪深度标签训练通用单目深度模型。模型使用 DINOv2 encoder 和 DPT decoder，并通过数据增强和辅助语义约束提高泛化。

单目深度通常预测相对深度，存在尺度与平移不确定性。Depth Anything 的强项是跨域结构泛化，而非天然提供绝对米制深度。

阅读时应区分 relative depth、metric depth 和 disparity。不同 benchmark 的对齐方式会显著影响指标，不能直接比较未统一尺度的误差。

## InternImage

[InternImage: Exploring Large-Scale Vision Foundation Models with Deformable Convolutions](https://arxiv.org/abs/2211.05778) 使用 DCNv3 构建大规模卷积视觉基础模型。与固定网格卷积不同，可变形卷积学习采样偏移和权重，使感受野适应对象形状。

DCNv3 采用分组、softmax 归一化和更高效实现，提高稳定性与扩展性。网络保持 CNN 的层级金字塔，同时获得类似 attention 的输入自适应空间聚合。

InternImage 适合与 ViT/Swin 对比：卷积路线保留局部性与多尺度结构，Transformer 路线更直接建模全局关系。最终性能还受预训练规模和任务 head 影响。

## V-JEPA

[V-JEPA: Video Joint Embedding Predictive Architectures](https://arxiv.org/abs/2402.08446) 不重建像素，而在潜在表示空间预测被遮盖视频区域。context encoder 读取可见 tube，predictor 根据位置 token 预测 target encoder 的潜在特征。

target encoder 由 context encoder 的 EMA 更新。损失直接比较预测特征与目标特征：

$$
\mathcal L=\frac{1}{|M|}\sum_{i\in M}\|\hat y_i-y_i\|_1.
$$

潜空间预测避免浪费容量重建纹理细节，更关注对象与运动结构。学习时应分析 mask 策略、target collapse 防护，以及冻结表征在动作识别和视频理解上的迁移。

## Architecture Comparison

| 方向 | 代表论文 | 核心表示 | 主要学习信号 |
| --- | --- | --- | --- |
| CNN | AlexNet/VGG/ResNet/InternImage | 局部网格特征 | 监督分类 |
| Vision Transformer | ViT/MAE/DINOv2 | Patch token | 监督、重建或蒸馏 |
| Open Vocabulary | Grounding DINO/OpenScene | 图文对齐特征 | 图文与 grounding 数据 |
| Prompt Segmentation | SAM/SAM 2 | Prompt-conditioned mask | 大规模 mask 数据 |
| Point Cloud | PointNet/PointNet++ | 无序点集与局部集合 | 分类和分割 |
| Geometry Foundation | DUSt3R/VGGT | Pointmap 与相机 token | 多任务几何监督 |
| Novel View | 3DGS | 显式高斯 | 多视角重建 |
| Predictive Video | V-JEPA | 潜空间时序特征 | Masked feature prediction |

## Reading Order

第一阶段阅读 AlexNet、VGG、ResNet 和 ViT，掌握卷积层级与 patch token 两种基本表示。第二阶段阅读 MAE、DINO 和 DINOv2，比较像素重建、自蒸馏与大规模数据策展。

第三阶段阅读 Grounding DINO、SAM 和 SAM 2，理解开放词汇检测、prompt 分割与视频 memory。第四阶段阅读 PointNet、PointNet++ 和 OpenScene，进入点云与开放词汇三维理解。

第五阶段阅读 DUSt3R、VGGT、3DGS 和 Depth Anything，比较 pointmap、相机、显式场景表示与单目深度。最后阅读 InternImage 和 V-JEPA，观察 CNN 与潜空间视频预测的另一条基础模型路线。

统一阅读记录应包含输入分辨率、token/点数量、backbone、预训练目标、数据规模、输出坐标、是否需要相机参数、下游任务和推理复杂度。CV 模型常因输入和数据不同产生巨大差距，不能只按最终指标排序。
