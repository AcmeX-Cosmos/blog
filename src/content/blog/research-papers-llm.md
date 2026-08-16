---
title: "Paper Reading: LLM 1 - 主流架构与训练方法演进"
date: "2025-07-20"
description: "从 GPT、BERT、T5 到 MoE、Mamba、Qwen2.5 与 DeepSeek，系统梳理大语言模型的架构、扩展规律、分布式训练和对齐方法。"
tags: ["LLM", "Transformer", "模型架构", "模型对齐", "论文合集"]
category: "research"
cover: "/blog/images/research/llm-architecture-map.svg"
references:
  - title: "Attention Is All You Need"
    meta: "Vaswani et al. · NeurIPS 2017"
    url: "https://arxiv.org/abs/1706.03762"
  - title: "BERT"
    meta: "Devlin et al. · NAACL 2019"
    url: "https://arxiv.org/abs/1810.04805"
  - title: "Training Compute-Optimal Large Language Models"
    meta: "Hoffmann et al. · NeurIPS 2022"
    url: "https://arxiv.org/abs/2203.15556"
  - title: "LLaMA"
    meta: "Touvron et al. · 2023"
    url: "https://arxiv.org/abs/2302.13971"
  - title: "DeepSeek-V3 Technical Report"
    meta: "DeepSeek-AI · 2024"
    url: "https://arxiv.org/abs/2412.19437"
---

![LLM architecture evolution map](/blog/images/research/llm-architecture-map.svg)

*本站原创整理图：从 Transformer 主干、规模化训练和偏好对齐到 MoE、MLA 与状态空间模型。*

## Transformer

[Attention Is All You Need](https://arxiv.org/abs/1706.03762) 奠定了现代语言模型的基本计算单元。输入 token 经 embedding 与位置编码后进入多层 self-attention 和前馈网络。单头缩放点积注意力为

$$
\operatorname{Attention}(Q,K,V)=
\operatorname{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}+M\right)V,
$$

其中 $M$ 可以是 padding mask 或 causal mask。除以 $\sqrt{d_k}$ 用于控制高维点积方差，避免 softmax 过早饱和。

Multi-Head Attention 将表示投影到多个子空间，各头独立计算后拼接。位置前馈网络则对每个 token 独立应用两层 MLP。残差连接和 LayerNorm 负责深层优化稳定性。

原论文采用 encoder-decoder：encoder 双向读取源序列，decoder 通过 causal self-attention 生成目标序列，并用 cross-attention 读取 encoder。后续 BERT 保留 encoder，GPT 保留 decoder，T5 延续完整 encoder-decoder。

## GPT-1

[Improving Language Understanding by Generative Pre-Training](https://cdn.openai.com/research-covers/language-unsupervised/language_understanding_paper.pdf) 建立“无监督语言模型预训练 + 有监督任务微调”范式。模型使用 decoder-only Transformer，以自回归目标预测下一个 token：

$$
\mathcal L_{LM}=-\sum_t\log p(x_t\mid x_{<t}).
$$

下游任务被转换成统一 token 序列，再添加线性输出层。分类、文本蕴含、相似度和多选题都可通过输入格式适配，而无需为每个任务设计复杂网络。

GPT-1 的意义在于证明生成式预训练能够学习可迁移语言表示。它也确立了 decoder-only 路线：同一个 causal 模型既能表示上下文，又能自然生成文本。

## BERT

[BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding](https://arxiv.org/abs/1810.04805) 使用 Transformer encoder 和双向上下文。核心预训练任务是 Masked Language Modeling：随机遮盖部分 token，并根据左右文恢复原词。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/bert-architecture.webp" alt="BERT 双向编码器预训练与任务微调架构" loading="lazy" decoding="async" />
  <figcaption>BERT：双向 Transformer 编码器预训练后接入不同下游任务头。图源：<a href="https://arxiv.org/abs/1810.04805">论文原文</a>。</figcaption>
</figure>

与 causal LM 只能关注左侧不同，BERT 的每个位置都能读取完整序列，因此更适合句子分类、序列标注和抽取式问答。原论文还使用 Next Sentence Prediction 学习句间关系，后续工作则发现 NSP 并非总是必要。

BERT 的输入由 token、segment 和 position embedding 相加。`[CLS]` 表示用于句级任务，`[SEP]` 分隔句子。学习时应理解预训练与微调目标不一致带来的 mask mismatch，以及 encoder-only 模型为何不擅长自由生成。

## GPT-2

[Language Models are Unsupervised Multitask Learners](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) 将 GPT 扩展到更大模型与 WebText 数据，并强调零样本任务迁移。任务条件不再依赖专用分类头，而通过自然语言上下文隐式表达。

GPT-2 使用 byte-level BPE，兼顾开放词表与合理序列长度。架构采用 pre-norm 风格调整，并扩大上下文与参数规模。它展示了摘要、翻译和问答等能力会随语言建模规模出现，但零样本效果仍不稳定。

这篇论文应重点阅读数据构建、tokenizer 和 scale 对行为的影响。模型结构变化有限，能力提升主要来自更大数据、更大参数与统一生成接口。

## Megatron-LM

[Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism](https://arxiv.org/abs/1909.08053) 研究单个 Transformer 层如何跨 GPU 切分。MLP 的第一层按列切分、第二层按行切分，使中间激活不需要频繁全量聚合；attention head 也可以自然分配到不同设备。

Tensor Parallelism 解决单层放不进一张卡的问题，Pipeline Parallelism 解决多层跨设备排布，Data Parallelism 则复制模型处理不同 batch。现代大模型训练通常组合三者形成 3D parallelism。

阅读重点不是记通信函数，而是标注每个矩阵乘法的张量形状、切分维度和 all-reduce 位置。并行策略的目标是在显存、通信量和设备利用率之间平衡。

## T5

[Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer](https://arxiv.org/abs/1910.10683) 把分类、翻译、摘要和问答统一成 text-to-text 任务。输入用自然语言前缀描述任务，模型始终生成目标文本。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/t5-architecture.webp" alt="T5 encoder-decoder、decoder-only 与 prefix LM 结构对比" loading="lazy" decoding="async" />
  <figcaption>T5：encoder-decoder、causal language model 与 prefix LM 的注意力结构对照。图源：<a href="https://arxiv.org/abs/1910.10683">论文原文</a>。</figcaption>
</figure>

T5 使用 encoder-decoder Transformer 和 span corruption。连续 token span 被替换成 sentinel token，decoder 依次生成被遮盖片段。相比逐 token mask，span corruption 更接近短语级恢复，并降低 decoder 目标长度。

论文还系统比较数据集、预训练目标、架构和模型规模。T5 的价值在于实验方法：统一框架让变量之间可以公平消融，而不仅是提出一个新模型。

## ZeRO

[ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054) 观察到数据并行会在每张 GPU 重复存储参数、梯度和优化器状态。ZeRO 逐阶段把这些状态分片：Stage 1 分优化器状态，Stage 2 继续分梯度，Stage 3 再分参数。

以 Adam 和混合精度训练为例，每个参数除了模型权重，还可能对应 FP32 master weight、梯度、一阶矩和二阶矩。真正显存占用远高于参数本身。ZeRO 通过通信换显存，使更大模型能够继续使用数据并行接口。

阅读时应计算不同 stage 下每张卡的状态量，并区分训练状态分片与 activation checkpointing。前者减少持久状态，后者通过重算减少中间激活。

## Scaling Laws

[Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361) 发现测试 loss 与参数量 $N$、数据量 $D$、计算量 $C$ 近似遵循幂律：

$$
L(N)\approx L_\infty + aN^{-\alpha}.
$$

类似关系也适用于数据和算力。幂律意味着模型扩展能够带来可预测收益，但边际收益逐步下降。

论文的实践价值是帮助决定预算分配和提前预测大规模实验结果。需要注意，Scaling Law 描述特定数据分布和训练设置下的统计规律，不能直接推断某项具体能力何时出现。

## GPT-3

[Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165) 将 decoder-only 模型扩展到 175B 参数，并系统研究 zero-shot、one-shot 与 few-shot in-context learning。模型权重在推理时不更新，任务通过 prompt 中的说明和示例定义。

In-context learning 改变了模型使用方式：同一个基础模型可以通过上下文适配大量任务。但示例顺序、格式、标签词和上下文分布会显著影响结果，这说明它不是稳定的符号解释器。

阅读实验时应区分参数规模收益、数据污染风险和 benchmark 选择。GPT-3 证明规模可以增强任务适配，却没有解决事实性、偏见和输出控制问题。

## Switch Transformer

[Switch Transformers](https://arxiv.org/abs/2101.03961) 使用稀疏 Mixture-of-Experts 扩展参数量。每个 token 经 router 选择一个前馈专家，而 attention 仍保持稠密。若专家数为 $E$，每个 token 只激活一个专家，计算量不随总参数线性增长。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/switch-transformer-architecture.webp" alt="Switch Transformer 稀疏专家路由架构" loading="lazy" decoding="async" />
  <figcaption>Switch Transformer：每个 token 由路由器分配给一个 FFN 专家。图源：<a href="https://arxiv.org/abs/2101.03961">论文原文</a>。</figcaption>
</figure>

Router 产生专家概率并选择 top-1：

$$
e(x)=\arg\max_i p_i(x),\qquad y=p_{e(x)}(x)E_{e(x)}(x).
$$

训练难点包括负载不均衡、专家容量溢出和跨设备 all-to-all 通信。辅助负载均衡损失鼓励 token 分布更均匀。

MoE 的“总参数量”与“每 token 激活参数量”必须分开报告。更大参数容量不等于成比例增加推理 FLOPs，但通信和显存仍会增长。

## Chain-of-Thought

[Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/abs/2201.11903) 在 few-shot 示例中加入自然语言中间推理步骤，显著提升算术、常识和符号任务表现。模型不再直接从问题跳到答案，而是生成一条可读的中间序列。

CoT 的收益随模型规模增强，说明较大模型更能利用分步计算。后续 zero-shot CoT、self-consistency 和 process supervision 都沿着“增加推理计算与中间约束”展开。

必须避免把 CoT 文本等同于模型真实因果过程。它是模型生成的一个可观察轨迹，可以提高准确率或辅助检查，但仍可能事后合理化错误答案。

## InstructGPT

[Training Language Models to Follow Instructions with Human Feedback](https://arxiv.org/abs/2203.02155) 建立经典 RLHF 流程：先用人工示范做 supervised fine-tuning，再用偏好比较训练 reward model，最后通过 PPO 优化策略，同时用 KL 惩罚限制模型偏离参考策略。

目标可简化为

$$
\max_\pi\;\mathbb E_{x,y\sim\pi}[r_\phi(x,y)]
-\beta D_{KL}(\pi(\cdot\mid x)\|\pi_{ref}(\cdot\mid x)).
$$

RLHF 优化的是标注者偏好代理，而不是绝对真理。奖励模型可能被策略利用，偏好数据也会引入群体与任务分布偏差。

## Chinchilla

[Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556) 重新研究固定训练算力下参数量与训练 token 的最优比例。结论是许多早期大模型参数过多、数据不足；参数和 token 应近似同步扩展。

Chinchilla 用更小参数、更多数据在相近算力下超过更大模型，说明模型大小不能脱离训练 token 讨论。计算最优训练强调预训练效率，而部署阶段仍可能偏好更小模型以降低推理成本。

阅读时应比较原始 Scaling Laws 与 Chinchilla 使用的实验拟合方法，并理解数据质量、重复 token 和训练轮数会改变最优点。

## LLaMA

[LLaMA: Open and Efficient Foundation Language Models](https://arxiv.org/abs/2302.13971) 证明使用公开数据和 compute-optimal 训练，小于超大闭源模型的参数规模也能达到强性能。架构采用 RMSNorm、SwiGLU 和 Rotary Position Embedding。

RMSNorm 不减均值，只按均方根缩放；SwiGLU 用门控激活提高前馈层表达；RoPE 将相对位置信息编码进 query/key 旋转。它们成为后续开源 LLM 的常见默认组件。

LLaMA 的主要贡献是高质量开放基线和训练配方，而非全新 Transformer。阅读时应关注数据混合、token 数、上下文长度和不同参数规模的宽深配置。

## DPO

[Direct Preference Optimization](https://arxiv.org/abs/2305.18290) 将带 KL 约束的偏好优化推导为直接分类目标，无需显式训练 reward model 和运行在线 RL。对偏好对 $(y_w,y_l)$，损失为

$$
-\log\sigma\left(
\beta\log\frac{\pi_\theta(y_w\mid x)}{\pi_{ref}(y_w\mid x)}
-\beta\log\frac{\pi_\theta(y_l\mid x)}{\pi_{ref}(y_l\mid x)}
\right).
$$

DPO 实现简单、训练稳定，因此广泛用于指令模型对齐。它仍依赖参考策略、偏好数据质量和超参数 $\beta$。若偏好对覆盖不足，模型可能只学到表面风格。

## Mistral and Mixtral

[Mistral 7B](https://arxiv.org/abs/2310.06825) 使用 Grouped-Query Attention 和 Sliding-Window Attention 提高推理效率。GQA 让多个 query head 共享较少 key/value head，减少 KV cache；滑动窗口限制每层局部注意范围，多层叠加仍能传播长距离信息。

[Mixtral of Experts](https://arxiv.org/abs/2401.04088) 在 Mistral block 中引入 sparse MoE，每个 token 路由到 top-2 专家。模型拥有较大总参数，但每 token 只激活一部分。

这两篇适合一起阅读：Mistral 优化稠密模型推理，Mixtral 优化参数容量扩展。比较时应同时看激活参数、内存带宽、KV cache 和专家通信。

## Mamba

[Mamba: Linear-Time Sequence Modeling with Selective State Spaces](https://arxiv.org/abs/2312.00752) 用选择性状态空间模型替代注意力。连续状态方程离散后可写为

<figure class="paper-figure">
  <img src="/blog/images/research/papers/mamba-architecture.webp" alt="Mamba 选择性状态空间模型架构" loading="lazy" decoding="async" />
  <figcaption>Mamba：输入相关的 selective scan 在保持线性复杂度的同时进行内容选择。图源：<a href="https://arxiv.org/abs/2312.00752">论文原文</a>。</figcaption>
</figure>

$$
h_t=\bar A_t h_{t-1}+\bar B_t x_t,\qquad
y_t=C_t h_t,
$$

其中 $B_t$、$C_t$ 和步长由输入动态产生，使模型能够选择性保留或遗忘信息。

Mamba 训练时使用硬件感知 parallel scan，推理时只维护固定大小状态，因此序列复杂度近似线性。它避免 attention 的二次序列开销和随上下文增长的 KV cache。

局限在于状态压缩可能损失精确检索能力。阅读实验应特别关注长上下文回忆、复制任务和与强 Transformer 基线的等算力比较。

## Qwen2.5

[Qwen2.5 Technical Report](https://arxiv.org/abs/2412.15115) 描述从小型到大型、稠密到 MoE 的完整模型系列。架构延续 decoder-only Transformer，采用 RoPE、SwiGLU、RMSNorm、GQA 等成熟组件，并扩展多语言、代码、数学和长上下文数据。

Qwen2.5 的价值更多来自系统化数据与后训练：预训练数据清洗、合成数据、指令微调、偏好优化和不同任务模型协同。模型系列化也便于研究参数规模与部署成本。

阅读技术报告时应把可验证架构信息、数据描述和 benchmark 结果分开。闭源数据配方往往无法完整复现，需要通过消融判断结论边界。

## DeepSeek-V3

[DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437) 提出大规模 MoE 模型，使用 Multi-head Latent Attention、DeepSeekMoE 和辅助损失自由的负载均衡。MLA 将 key/value 压缩到低维 latent，显著降低 KV cache。

DeepSeekMoE 细分专家并设置共享专家，使通用知识与路由知识分工。模型总参数很大，但每 token 只激活部分专家。训练还采用 FP8、DualPipe 和多 token prediction 提升系统效率与表示学习。

阅读时应区分算法创新与工程系统：MLA 改变注意力缓存结构，MoE 改变激活参数，FP8 与并行调度改变训练吞吐。这三类收益不能简单相加比较。

## DeepSeek-R1

[DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning](https://arxiv.org/abs/2501.12948) 研究如何通过强化学习激发长链推理。R1-Zero 从基础模型直接进行规则可验证奖励的 RL，出现自我检查、反思和长推理行为；R1 则加入冷启动数据与多阶段训练改善可读性和通用能力。

GRPO 使用同一问题的一组采样相对优势，避免单独训练大型 critic。对于可自动验证的数学和代码任务，准确率可以直接成为奖励的一部分。

这篇论文应重点分析奖励可验证性、采样预算、推理长度和蒸馏。推理 token 增长相当于增加测试时计算，但更长输出不保证更正确，也会显著提高延迟。

## Architecture Comparison

| 路线 | 代表模型 | 训练目标 | 优势 | 核心代价 |
| --- | --- | --- | --- | --- |
| Encoder-only | BERT | Masked LM | 双向理解 | 不擅长开放生成 |
| Decoder-only | GPT/LLaMA/Qwen | Causal LM | 统一生成接口 | 自回归延迟 |
| Encoder-decoder | T5 | Span corruption + seq2seq | 条件生成清晰 | 两套计算栈 |
| Sparse MoE | Switch/Mixtral/DeepSeek | LM + routing | 扩展参数容量 | 路由与通信复杂 |
| State Space | Mamba | Causal sequence modeling | 线性序列复杂度 | 精确检索仍具挑战 |
| Preference alignment | InstructGPT/DPO | Reward/Pairs | 改善指令遵循 | 受偏好数据约束 |

## Reading Order

第一阶段阅读 Transformer、GPT-1、BERT、GPT-2 和 T5，理解三种主干架构与预训练目标。第二阶段阅读 Megatron-LM、ZeRO、Scaling Laws、Chinchilla 和 Switch Transformer，建立训练规模、显存与算力意识。

第三阶段阅读 GPT-3、CoT、InstructGPT 和 DPO，理解 in-context learning、测试时推理和偏好对齐。第四阶段阅读 LLaMA、Mistral/Mixtral、Mamba、Qwen2.5、DeepSeek-V3 与 DeepSeek-R1，比较现代模型在架构、数据、系统和后训练上的分工。

建议每篇论文统一记录参数量、训练 token、上下文长度、attention 类型、位置编码、FFN 类型、并行方式、预训练目标、后训练方法、推理缓存和 benchmark 范围。模型名称会快速更新，这些结构化字段更能长期复用。
