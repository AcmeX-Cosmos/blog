---
title: "Paper Reading: VLM 与 VLA 主流模型架构"
date: "2026-08-13"
description: "从图文对比学习、多模态连接器到动作 Token、扩散策略与 Flow Matching，系统梳理 VLM/VLA 主流模型架构和训练目标。"
tags: ["VLM", "VLA", "多模态", "机器人基础模型", "论文合集"]
category: "research"
pinned: true
cover: "/blog/images/research/vla-vlm-architecture-map.svg"
references:
  - title: "CLIP"
    meta: "Radford et al. · ICML 2021"
    url: "https://arxiv.org/abs/2103.00020"
  - title: "BLIP-2"
    meta: "Li et al. · ICML 2023"
    url: "https://arxiv.org/abs/2301.12597"
  - title: "RT-2"
    meta: "Brohan et al. · CoRL 2023"
    url: "https://arxiv.org/abs/2307.15818"
  - title: "OpenVLA"
    meta: "Kim et al. · CoRL 2024"
    url: "https://arxiv.org/abs/2406.09246"
  - title: "PI-0"
    meta: "Physical Intelligence · 2024"
    url: "https://arxiv.org/abs/2410.24164"
---

![VLM and VLA architecture map](/blog/images/research/vla-vlm-architecture-map.svg)

*本站原创整理图：从视觉编码器、多模态连接器和语言主干延伸到四类动作生成接口。*

## Architecture Map

VLM 的基本问题是把视觉表示接入语言模型，使模型能够在统一 token 空间中完成理解与生成。主流架构可分为三类：CLIP 式双编码器负责对齐与检索；Flamingo 式 cross-attention 在冻结语言模型中注入视觉条件；BLIP-2、LLaVA、Qwen-VL 和 InternVL 使用查询器或投影器把视觉 token 转成语言模型可消费的序列。

VLA 在此基础上增加时间、本体状态和动作。动作可以是离散 token、连续回归、动作块、扩散轨迹或 flow matching 生成。阅读 VLA 论文时必须明确四个接口：动作坐标系、控制频率、预测 horizon 和闭环查询频率。

## CLIP

[Learning Transferable Visual Models From Natural Language Supervision](https://arxiv.org/abs/2103.00020) 使用独立图像编码器和文本编码器，把匹配图文对拉近、批内错误配对推远。对 batch 中第 $i$ 个图像和第 $j$ 个文本，logit 为

<figure class="paper-figure">
  <img src="/blog/images/research/papers/clip-architecture.webp" alt="CLIP 图像文本双编码器对比学习架构" loading="lazy" decoding="async" />
  <figcaption>CLIP：图像与文本双编码器通过批内对比学习建立共享表示空间。图源：<a href="https://arxiv.org/abs/2103.00020">论文原文</a>。</figcaption>
</figure>

$$
s_{ij}=\frac{f_I(x_i)^\top f_T(t_j)}{\tau},
$$

训练目标是图到文与文到图两个交叉熵的平均。温度 $\tau$ 控制分布尖锐程度。

CLIP 建立了开放词汇迁移范式：类别名称可以直接成为文本 prompt，无需重新训练固定分类头。但它主要对齐全局语义，精确计数、空间关系和像素定位并不是其训练目标。

阅读时应掌握双塔架构、对比损失、prompt ensemble 和 zero-shot classifier 的构造，并理解大规模弱标注数据为何能替代人工类别体系。

## Flamingo

[Flamingo: a Visual Language Model for Few-Shot Learning](https://arxiv.org/abs/2204.14198) 通过 Perceiver Resampler 和 gated cross-attention 把视觉信息注入冻结语言模型。Resampler 将可变数量的图像/视频特征压缩成固定数量视觉 token，降低多图上下文成本。

Gated cross-attention 层插入语言模型 block 之间，其输出带可学习门控，初始时近似不干扰语言模型。文本 token 只能关注此前出现的视觉输入，从而支持图文交错序列和 few-shot 示例。

Flamingo 的关键不是简单拼接 token，而是处理多图、视频和长上下文时的计算结构。学习时应比较 cross-attention 与 prefix token 两种视觉注入方法的显存、位置关系和冻结策略。

## BLIP-2

[BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models](https://arxiv.org/abs/2301.12597) 在冻结视觉编码器与冻结 LLM 之间加入轻量 Q-Former。Q-Former 的 learnable query 通过 cross-attention 从图像特征中抽取与文本相关的信息。

训练分两阶段。第一阶段做图文对比、图文匹配和图像条件文本生成，让 query 学会从视觉特征提取语言相关内容；第二阶段将 query 输出投影到 LLM embedding 空间，进行视觉到语言的生成学习。

Q-Former 是一个显式信息瓶颈。query 数量太少会丢失细粒度空间信息，太多则增加 LLM 上下文成本。BLIP-2 适合学习“冻结大模型、训练连接器”的多模态适配范式。

## LLaVA

[Visual Instruction Tuning](https://arxiv.org/abs/2304.08485) 使用简单线性投影层连接 CLIP 视觉编码器与 LLaMA/Vicuna 类语言模型。图像 patch 特征被投影到语言 embedding 维度，与文本 token 一同输入自回归模型。

训练通常分为特征对齐和视觉指令微调：第一阶段冻结视觉与语言主干，只训练 projector；第二阶段冻结视觉编码器，联合更新 projector 和 LLM。方法结构简单，证明高质量多模态指令数据能够显著改变模型交互能力。

LLaVA 的研究重点在数据配方而不只是 projector。预训练图文对决定基础对齐，指令数据决定回答风格、任务覆盖与幻觉模式。评价时应分开考察感知、知识、推理和对话偏好。

## Qwen-VL

[Qwen-VL: A Frontier Large Vision-Language Model with Versatile Abilities](https://arxiv.org/abs/2308.12966) 采用视觉 Transformer、视觉-language adapter 和 Qwen LLM。视觉特征通过 cross-attention resampler 压缩，并引入位置相关输出以支持 grounding 和文本读取。

模型训练覆盖大规模图文预训练、多任务监督微调和对话对齐。除通用 VQA 外，Qwen-VL 强调 OCR、文档理解、检测框输出和多语言能力，体现 VLM 从全局描述向细粒度定位扩展的趋势。

阅读时应关注分辨率、视觉 token 数、坐标离散化方式和 grounding 数据比例。能输出坐标不代表具备稳定几何推理，定位误差仍需专门 benchmark。

## InternVL

[InternVL: Scaling up Vision Foundation Models and Aligning for Generic Visual-Linguistic Tasks](https://arxiv.org/abs/2312.14238) 探索把视觉编码器扩展到十亿参数级，并通过对比、生成和语言对齐构建通用多模态系统。InternViT 使用 ViT 架构，视觉特征随后通过连接模块进入 LLM。

后续动态高分辨率策略把大图切成多个 tile，并保留缩略图作为全局上下文。这提高文档、图表和小目标理解，但视觉 token 数会随 tile 数快速增长。

学习 InternVL 应把模型规模与输入分辨率分开分析。很多视觉语言任务的提升来自更高像素预算，而不完全来自更强推理能力。

## PaLM-E

[PaLM-E: An Embodied Multimodal Language Model](https://arxiv.org/abs/2303.03378) 将图像、连续状态和其他传感器表示编码成与词 embedding 同维度的 token，直接插入预训练语言模型上下文。模型以自回归方式输出文本计划、答案或高层决策。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/palm-e-architecture.webp" alt="PaLM-E 连续传感器输入与语言模型架构" loading="lazy" decoding="async" />
  <figcaption>PaLM-E：连续视觉和状态表示作为多模态 token 注入 PaLM。图源：<a href="https://arxiv.org/abs/2303.03378">论文原文</a>。</figcaption>
</figure>

PaLM-E 说明连续具身输入可以与语言 token 共用一个 decoder-only Transformer，并观察到视觉语言任务与具身任务之间的正迁移。它的动作通常通过下游策略或文本形式表达，而非直接输出高频连续控制。

论文适合学习多任务混合和传感器 tokenization。需要注意，统一 token 空间并不等于统一控制接口；不同输出仍可能需要不同 decoder 或执行模块。

## RT-1

[RT-1: Robotics Transformer for Real-World Control at Scale](https://arxiv.org/abs/2212.06817) 将图像、语言指令和历史信息编码为 token，再用 Transformer 预测离散动作。视觉部分使用 EfficientNet，并通过 FiLM 由语言条件调制；TokenLearner 将空间特征压缩成少量 token。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/rt1-architecture.webp" alt="RT-1 视觉语言调制与动作 token 预测架构" loading="lazy" decoding="async" />
  <figcaption>RT-1：FiLM、TokenLearner 与 Transformer 组成端到端多任务控制策略。图源：<a href="https://arxiv.org/abs/2212.06817">论文原文</a>。</figcaption>
</figure>

连续动作维度被分别离散为若干 bins，自回归或并行预测动作 token。离散化使训练变成分类问题，也便于处理多维动作，但会引入量化误差。

RT-1 的核心结论来自大规模多任务真实数据：增加任务和对象多样性能够改善新任务组合表现。阅读实验时应区分 seen task、unseen task 和背景干扰，不能只看平均成功率。

## ACT

[Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware](https://arxiv.org/abs/2304.13705) 提出 Action Chunking with Transformers。策略一次预测未来 $H$ 步动作块，减少逐步行为克隆的误差累积，并用 temporal ensemble 融合不同时间产生的重叠预测。

训练时 CVAE 编码演示动作块得到潜变量 $z$，Transformer decoder 根据多相机特征、本体状态和 $z$ 重建动作：

$$
\mathcal L=\mathcal L_{action}+\beta D_{KL}\bigl(q_\phi(z\mid o,a)\|\mathcal N(0,I)\bigr).
$$

推理时从先验取确定性中心或样本生成动作块。chunk 长度控制响应性与时序一致性的权衡：长块更平滑，但扰动后重规划更慢；短块更灵活，却增加查询抖动。

## Diffusion Policy

[Diffusion Policy: Visuomotor Policy Learning via Action Diffusion](https://arxiv.org/abs/2303.04137) 把动作序列建模为条件扩散过程。训练时给真实动作轨迹加入噪声，网络根据观测、扩散时间和噪声轨迹预测噪声或 score：

$$
\mathcal L=\mathbb E_{a,\epsilon,k}
\left[\|\epsilon-\epsilon_\theta(\sqrt{\bar\alpha_k}a+
\sqrt{1-\bar\alpha_k}\epsilon,o,k)\|_2^2\right].
$$

推理从高斯噪声开始多步去噪，得到一段连续动作。扩散模型能表达多峰分布，避免 MSE 回归在两个可行轨迹之间取不可行平均。

代价是迭代采样延迟。论文使用 receding horizon，只执行预测序列前若干步后重新观测。学习时应同时分析扩散步数、动作 horizon、执行 horizon 与控制频率。

## RT-2

[RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818) 把机器人动作编码成文本 token，和视觉语言任务共同训练 PaLI-X 或 PaLM-E 类模型。动作序列以特殊数字格式出现在语言输出空间中。

这种做法允许 Web-scale 视觉语言预训练与机器人数据共享模型参数，使语义概念、对象类别和简单推理迁移到控制任务。核心不是动作本身变成了语言，而是动作与语言共用自回归目标和表示空间。

需要关注动作 token 的量化、无效 token 约束和解码延迟。语言模型的开放词表输出能力在动作阶段反而需要被严格限制。

## Octo

[Octo: An Open-Source Generalist Robot Policy](https://arxiv.org/abs/2405.12213) 使用 Transformer 在 Open X-Embodiment 等异构数据上预训练。模型将时序图像、本体状态和任务条件编码为 token，并通过 action readout 预测动作块。

Octo 使用模块化 tokenizers 和 heads，使新传感器、新任务条件和新机器人动作空间能够通过替换局部模块适配。训练时还通过任务 token masking 支持语言条件与目标图像条件。

阅读重点是 block-wise attention、观测窗口、动作 chunk 和下游微调。通用策略的关键不只是 backbone，而是如何定义可扩展的输入输出接口。

## OpenVLA

[OpenVLA: An Open-Source Vision-Language-Action Model](https://arxiv.org/abs/2406.09246) 基于 Prismatic VLM 构建 7B VLA，结合 DINOv2 与 SigLIP 视觉特征，并在 Open X-Embodiment 数据上训练离散动作 token。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/openvla-architecture.webp" alt="OpenVLA 双视觉编码器与动作 token 架构" loading="lazy" decoding="async" />
  <figcaption>OpenVLA：DINOv2 与 SigLIP 视觉特征接入语言模型并生成动作 token。图源：<a href="https://arxiv.org/abs/2406.09246">论文原文</a>。</figcaption>
</figure>

DINOv2 提供细粒度空间特征，SigLIP 提供语义对齐，两路视觉特征拼接后投影到 LLM。每个动作维度通过分位数离散化映射到特殊 token，模型以标准 next-token loss 学习。

OpenVLA 适合研究视觉表示组合、动作 tokenizer 和参数高效微调。评价时应同时报告控制成功率、推理频率、量化误差和显存，而不只比较模型参数量。

## RDT-1B

[RDT-1B: a Diffusion Foundation Model for Bimanual Manipulation](https://arxiv.org/abs/2410.07864) 使用 diffusion Transformer 处理异构双臂机器人数据。模型把语言、图像、本体状态与噪声动作序列分别编码，再通过交替条件注入完成去噪。

RDT 强调 physical state 与动作的统一表示，并通过数据重采样、动作归一化和不同本体 mask 处理异构数据。扩散目标保留连续动作精度，Transformer 则扩展模型容量。

阅读时应关注不同条件进入 DiT block 的方式、动作维度对齐、数据采样权重和从预训练到下游微调的变化。跨本体性能主要受接口统一与数据覆盖共同影响。

## PI-0

[$\pi_0$: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164) 将预训练 VLM 与 flow-matching action expert 组合。VLM 负责图像和语言条件表示，动作专家在连续动作空间中学习从噪声到数据分布的向量场。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/pi0-architecture.webp" alt="PI-0 视觉语言主干与动作专家架构" loading="lazy" decoding="async" />
  <figcaption>PI-0：预训练 VLM 与连续动作 flow expert 的联合结构。图源：<a href="https://arxiv.org/abs/2410.24164">论文原文</a>。</figcaption>
</figure>

Flow matching 训练目标可写成

$$
\mathcal L=\mathbb E_{a,\epsilon,t}
\left[\|v_\theta(a_t,o,t)-u_t(a,\epsilon)\|_2^2\right],
$$

推理通过常微分方程积分，把噪声动作变成动作块。与离散 action token 相比，它保留连续精度；与多步 diffusion 相比，可采用较少积分步数。

架构上的关键是把高容量语义模型与专门的连续控制 head 分开，使两者共享条件表示但不强迫动作进入语言词表。

## FAST

[FAST: Efficient Action Tokenization for Vision-Language-Action Models](https://arxiv.org/abs/2501.09747) 针对高频连续动作难以高效 token 化的问题，先对动作序列做离散余弦变换，再量化频域系数并用 byte-pair encoding 压缩。

平滑轨迹的能量集中在低频，频域表示比逐时刻逐维度离散产生更短 token 序列。FAST 因而能让自回归 VLA 用较少 token 表达较长动作块，同时保留轨迹细节。

阅读时应分析重建误差、token 数、不同控制频率和不连续动作。频域压缩对平滑运动有效，但对接触瞬间和离散夹爪动作需要单独处理。

## Architecture Comparison

| 架构 | 视觉语言连接 | 动作表示 | 主要优势 | 主要代价 |
| --- | --- | --- | --- | --- |
| CLIP | 双编码器对比对齐 | 无 | 开放词汇检索 | 缺少生成和精确定位 |
| BLIP-2 | Q-Former | 无 | 冻结主干、训练高效 | query 信息瓶颈 |
| LLaVA | 视觉 projector | 无 | 结构简单、易扩展 | 依赖指令数据质量 |
| RT-1/RT-2 | Transformer/VLM | 离散 token | 统一分类或语言目标 | 量化误差 |
| ACT | 多视角特征 + decoder | 连续动作块 | 精细时序、推理直接 | chunk 超参数敏感 |
| Diffusion Policy | 条件去噪网络 | 连续轨迹 | 多峰动作分布 | 多步采样延迟 |
| OpenVLA | 双视觉编码器 + LLM | 离散 token | 开放模型与数据 | 推理成本较高 |
| PI-0 | VLM + action expert | Flow matching | 语义与连续控制分工 | 训练和部署复杂 |

## Reading Order

第一阶段依次阅读 CLIP、Flamingo、BLIP-2 和 LLaVA，掌握双塔、cross-attention、query bottleneck 与 projector 四种连接范式。第二阶段阅读 RT-1、ACT 和 Diffusion Policy，比较离散单步、连续动作块与生成式轨迹。

第三阶段阅读 PaLM-E、RT-2、Octo 和 OpenVLA，理解 VLM 预训练、大规模机器人数据与动作 token 的结合。第四阶段阅读 RDT-1B、PI-0 和 FAST，研究 diffusion Transformer、flow matching 与高效动作 tokenizer。

每篇论文建议固定记录：视觉编码器、语言模型、连接器、状态输入、动作空间、训练目标、数据规模、控制频率、预测 horizon、执行 horizon、推理延迟和泛化划分。只有接口相同的结果才适合直接比较。
