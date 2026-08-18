---
title: "Paper Reading: Embodied AI 1 - 主流模型与具身学习架构"
date: "2025-08-25"
description: "聚焦具身智能中高影响力和高热度的代表论文，覆盖模仿学习、VLA、语言规划、空间推理、大规模数据、生成式策略与抓取感知。"
tags: ["Embodied AI", "具身智能", "机器人学习", "VLA", "论文合集"]
category: "research"
cover: "/blog/images/research/embodied-ai-architecture-map.svg"
references:
  - title: "ACT"
    meta: "Zhao et al. · RSS 2023"
    url: "https://arxiv.org/abs/2304.13705"
  - title: "Diffusion Policy"
    meta: "Chi et al. · RSS 2023"
    url: "https://arxiv.org/abs/2303.04137"
  - title: "Open X-Embodiment"
    meta: "O'Neill et al. · ICRA 2024"
    url: "https://arxiv.org/abs/2310.08864"
  - title: "OpenVLA"
    meta: "Kim et al. · CoRL 2024"
    url: "https://arxiv.org/abs/2406.09246"
  - title: "PI-0"
    meta: "Physical Intelligence · 2024"
    url: "https://arxiv.org/abs/2410.24164"
---

![Embodied AI architecture map](/blog/images/research/embodied-ai-architecture-map.svg)

*本站原创整理图：按模仿学习、通用 VLA、生成式动作与具身推理划分代表架构。*

## Research Map

Embodied AI 的核心不是单一模型，而是把感知、任务条件、状态历史和动作组织成闭环策略。当前主流研究可以沿四条线理解：ACT 与 Diffusion Policy 代表高质量模仿学习；RT-1、RT-2、OpenVLA、RDT-1B 与 PI-0 代表 VLA 架构；SayCan、Code as Policies、VoxPoser 与 ReKep 代表语言和空间推理；Open X-Embodiment、MimicGen 与 Octo 代表数据规模和通用策略。

阅读任何具身论文前，先记录六个字段：观测模态、任务条件、动作表示、预测 horizon、执行频率和成功判据。相同的“成功率”可能来自完全不同的动作空间与环境假设，只有这些接口接近时，模型结果才适合直接比较。

## ACT

[Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware](https://arxiv.org/abs/2304.13705) 提出 Action Chunking with Transformers。传统行为克隆每个时刻预测一个动作，误差会随闭环执行积累；ACT 一次预测未来 $H$ 步动作块，用较长时间结构降低有效决策次数。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/act-architecture.webp" alt="ACT 条件 VAE 与动作块预测架构" loading="lazy" decoding="async" />
  <figcaption>ACT：视觉与本体状态经 Transformer 解码为未来动作块。图源：<a href="https://arxiv.org/abs/2304.13705">论文原文</a>。</figcaption>
</figure>

模型是条件 VAE。训练时，动作块编码器根据本体状态和真实动作得到潜变量分布；多相机视觉特征、本体状态与潜变量进入 Transformer decoder，输出未来动作序列。损失由动作 L1 和 KL 正则组成：

$$
\mathcal L=\|a-\hat a\|_1+\beta D_{KL}
\left(q_\phi(z\mid o,a)\|\mathcal N(0,I)\right).
$$

推理时，不同查询产生的动作块在当前时刻重叠。Temporal Ensemble 对这些预测做指数加权，减少块边界跳变。ACT 的关键超参数是 chunk length：更长的 chunk 有利于平滑和长时序一致性，却降低扰动后的重规划速度。

## Diffusion Policy

[Diffusion Policy: Visuomotor Policy Learning via Action Diffusion](https://arxiv.org/abs/2303.04137) 把动作轨迹视为条件生成问题。训练阶段给真实动作序列逐步加高斯噪声，网络学习在视觉与状态条件下预测噪声；推理阶段从随机噪声反复去噪得到完整动作序列。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/diffusion-policy-architecture.webp" alt="Diffusion Policy 条件去噪策略架构" loading="lazy" decoding="async" />
  <figcaption>Diffusion Policy：在观测条件下迭代去噪动作序列。图源：<a href="https://arxiv.org/abs/2303.04137">论文原文</a>。</figcaption>
</figure>

动作分布经常是多峰的。例如绕过障碍可以从左侧或右侧完成，普通 MSE 回归容易输出两者之间的不可行平均；扩散模型可以保留多个模式，并通过一次采样选择其中一条连贯轨迹。

论文采用 receding horizon control：预测较长序列，只执行前几步，然后根据新观测重新采样。需要同时理解 observation horizon、prediction horizon、action horizon 和 diffusion steps，它们共同决定响应性、稳定性和延迟。

## RT-1

[RT-1: Robotics Transformer for Real-World Control at Scale](https://arxiv.org/abs/2212.06817) 研究大规模真实机器人多任务训练。语言指令通过 FiLM 调制 EfficientNet 视觉特征，TokenLearner 将高分辨率空间特征压缩成少量 token，Transformer 读取历史并输出离散动作。

每个连续动作维度被量化成 bins，夹爪、终止等离散动作也转成 token。这样训练可统一为分类，但量化分辨率与动作范围会直接影响控制精度。

RT-1 的高影响力来自数据结论：任务、对象和场景多样性比单纯重复同一任务更能改善泛化。论文分别测试已见任务、新任务和背景干扰，展示通用策略需要覆盖变化来源，而不只是扩大模型。

## RT-2

[RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818) 将动作也编码成 VLM 的文本 token，使机器人轨迹与 Web 视觉语言数据共享自回归训练目标。模型基于 PaLI-X 或 PaLM-E，输出特殊格式的离散动作序列。

联合训练让语义知识迁移到控制，例如理解未在机器人数据中大量出现的对象类别、符号和简单关系。RT-2 的重要观察是，VLM 预训练不仅改善语言理解，也能改善某些语义泛化操作。

动作进入语言词表同时引入约束问题：解码器可能产生格式错误或词表外动作组合，推理速度也受大型 VLM 自回归生成限制。因此动作 tokenizer、合法 token mask 与控制频率是阅读重点。

## Open X-Embodiment and RT-X

[Open X-Embodiment](https://arxiv.org/abs/2310.08864) 汇集来自多机构、多机器人、多任务的数据，并提出 RT-X 跨本体策略。数据统一为 episode 结构，包含图像、本体状态、语言和动作，但原始机器人形态、相机、动作坐标系和控制频率仍然不同。

跨本体学习真正困难的是语义统一。一个数据集的动作可能是末端增量，另一个可能是绝对位姿或关节目标；夹爪开合方向也可能相反。统一格式只解决存储问题，动作归一化和本体条件才决定模型能否共享知识。

论文展示大规模混合数据的正迁移，同时也提醒采样权重的重要性。数据量最大的来源若主导训练，小型机器人或稀有任务可能发生负迁移。

## VIMA

[VIMA: General Robot Manipulation with Multimodal Prompts](https://arxiv.org/abs/2210.03094) 使用由文本和对象图像交错组成的 multimodal prompt 描述任务。相比纯语言，图像 prompt 可以直接指代未命名对象、材质或目标布局。

Prompt token 经预训练语言模型与对象编码器处理，历史对象 token 和动作 token 进入 causal Transformer，自回归输出离散动作。VIMA-Bench 将任务模板、对象、纹理和组合方式分成多个泛化等级。

VIMA 的价值在于任务接口与评估设计。多模态 prompt 不是简单增加图片，而是把对象实例本身变成语言中的可引用变量；分层 benchmark 则区分对象泛化、任务模板泛化和组合泛化。

## SayCan

[Do As I Can, Not As I Say](https://arxiv.org/abs/2204.01691) 把语言模型的任务相关性与技能价值函数的可执行性结合。对于候选技能 $a$，选择分数为

$$
S(a\mid s,g)=p_{LM}(a\mid g,h)Q(s,a).
$$

LLM 判断技能在语义上是否推进指令，价值函数判断当前状态能否完成技能。两者相乘后，语言上合理但物理上不可执行的动作会被抑制。

SayCan 建立了重要系统原则：语言模型只从已验证技能集合中选择，而不直接控制连续动作。阅读实验时应分别看语言规划准确率、技能成功率和完整任务成功率。

## PaLM-E

[PaLM-E: An Embodied Multimodal Language Model](https://arxiv.org/abs/2303.03378) 把图像、状态估计和其他连续传感器表示投影成与词向量同维度的 token，插入预训练 decoder-only LLM。模型在同一自回归框架中处理视觉问答、场景描述和具身任务。

传感器编码器可以是 ViT 或专用状态网络，输出经线性层进入语言上下文。不同任务共享 PaLM 主干和 next-token objective，论文观察到视觉语言数据与具身数据之间存在正迁移。

PaLM-E 证明连续观测能进入 LLM，但它并没有消除控制层。高层文本决策、低频计划和高频动作依然具有不同延迟与精度要求。

## Code as Policies

[Code as Policies](https://arxiv.org/abs/2209.07753) 使用代码生成模型组合感知与控制 API。程序天然支持变量、循环、条件和函数抽象，能够表达比扁平技能序列更复杂的空间逻辑。

系统可以递归生成未定义辅助函数，直到落到已有 primitive。语言指令中的“更靠近”“排成一列”或“依次移动”被转换成数值运算与 API 调用。

论文的另一面是执行安全：可调用函数集合、参数范围、超时、异常和副作用必须由外部系统限制。代码模型的表达能力越强，运行环境越需要沙箱和白名单。

## VoxPoser

[VoxPoser: Composable 3D Value Maps for Robotic Manipulation with Language Models](https://arxiv.org/abs/2307.05973) 让 LLM/VLM 生成三维空间价值图，而不是直接生成机器人轨迹。目标、障碍、方向和速度偏好分别形成体素场，再组合为运动优化目标。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/voxposer-architecture.webp" alt="VoxPoser 三维价值图与轨迹优化流程" loading="lazy" decoding="async" />
  <figcaption>VoxPoser：语言约束被组合为三维价值图，再交由运动规划器求解。图源：<a href="https://arxiv.org/abs/2307.05973">论文原文</a>。</figcaption>
</figure>

若轨迹为 $\tau$，规划可以表示为

$$
\tau^*=\arg\max_\tau \sum_j w_jV_j(\tau)-\lambda C(\tau),
$$

其中 $V_j$ 表示语义价值，$C$ 表示碰撞、平滑和运动代价。语言负责提出可组合空间约束，优化器负责求解连续轨迹。

VoxPoser 是理解“语义到几何中间表示”的代表工作。关键问题是哪些条件可以成为软价值，哪些安全约束必须是不可违反的硬条件。

## ReKep

[ReKep: Spatio-Temporal Reasoning of Relational Keypoint Constraints](https://arxiv.org/abs/2409.01652) 用关系关键点表达长时程操作。VLM 从图像和语言中选择任务相关关键点，生成子目标约束与路径约束，随后优化器逐阶段求解末端位姿。

关键点关系可以表达距离、对齐、方向和包含等条件。例如“杯口保持朝上”可写成方向向量与重力轴的夹角约束，“把物体放入容器”可写成关键点相对位置约束。

这种表示比自然语言步骤更可计算，比固定技能库更灵活。主要风险来自关键点漂移、遮挡、非刚体变化和局部优化初值。

## MimicGen

[MimicGen: A Data Generation System for Scalable Robot Learning using Human Demonstrations](https://arxiv.org/abs/2310.17596) 从少量人工演示自动生成大量新场景轨迹。方法将演示分割成对象中心的子任务片段，再根据新场景中的对象位姿变换每段轨迹，连接并执行得到新示范。

核心假设是子任务可以在对象坐标系中重定向。若原轨迹末端位姿为 ${}^OT_E$，对象在新场景中的位姿变化后，可通过坐标复合得到新的世界轨迹。

MimicGen 的价值是数据扩展而非新策略网络。评价时必须同时报告生成轨迹成功率、数据多样性和用生成数据训练后的策略收益，防止大量低质量轨迹稀释有效监督。

## Octo

[Octo: An Open-Source Generalist Robot Policy](https://arxiv.org/abs/2405.12213) 在大规模异构数据上训练通用 Transformer 策略。图像、本体状态和任务条件经不同 tokenizer 进入共享时序 backbone，动作 readout 预测未来动作块。

Octo 设计了可扩展接口：语言或目标图像都可以作为任务 token，新传感器可增加输入 tokenizer，新机器人可适配 action head。预训练 backbone 与下游 readout 的分离，使多种微调策略可以公平比较。

阅读时应关注 block-wise attention、任务 token masking、数据混合和下游适配。通用策略的能力不仅来自参数量，还来自统一而不丢失语义的输入输出契约。

## OpenVLA

[OpenVLA: An Open-Source Vision-Language-Action Model](https://arxiv.org/abs/2406.09246) 基于 7B VLM，在 Open X-Embodiment 数据上训练动作 token。视觉侧结合 DINOv2 与 SigLIP：前者强调密集空间特征，后者强调图文语义对齐。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/openvla-architecture.webp" alt="OpenVLA 双视觉编码器与动作 token 架构" loading="lazy" decoding="async" />
  <figcaption>OpenVLA：DINOv2 与 SigLIP 视觉特征接入语言模型并生成动作 token。图源：<a href="https://arxiv.org/abs/2406.09246">论文原文</a>。</figcaption>
</figure>

连续动作按训练数据分位数离散，并映射到 LLM 词表中的特殊 token。模型使用标准 next-token loss 联合学习语言条件、视觉观测和动作输出。

OpenVLA 提供公开权重、代码与微调方案，是研究 action tokenization 和参数高效适配的重要基线。需要同时考虑量化误差、VLM 推理成本和控制频率。

## RDT-1B

[RDT-1B: a Diffusion Foundation Model for Bimanual Manipulation](https://arxiv.org/abs/2410.07864) 使用 diffusion Transformer 在异构双臂数据上学习连续动作。语言、图像、本体状态和噪声动作分别编码，并通过条件注入进入去噪 block。

模型为不同机器人状态和动作维度设计统一表示与 mask，配合重采样和归一化处理数据不平衡。Diffusion objective 保留连续动作精度，Transformer 则扩展参数容量与条件融合能力。

RDT-1B 适合研究双臂动作的高维时序建模。分析时应区分预训练数据覆盖、跨本体接口和下游微调对性能的贡献。

## PI-0

[$\pi_0$: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164) 将预训练 VLM 与 flow-matching action expert 结合。VLM 处理图像和语言语义，动作专家在连续空间中预测从噪声分布到动作分布的向量场。

Flow matching 训练网络逼近概率路径速度：

$$
\mathcal L=\mathbb E_{a,\epsilon,t}
\left[\|v_\theta(a_t,o,t)-u_t(a,\epsilon)\|_2^2\right].
$$

推理通过数值积分生成动作块。与离散 token 相比，它不损失连续精度；与传统 diffusion 相比，可以用较少步数采样。VLM 与 action expert 的分工也代表 VLA 从单一 decoder 向专门动作 head 演进。

## FAST

[FAST: Efficient Action Tokenization for Vision-Language-Action Models](https://arxiv.org/abs/2501.09747) 解决高频连续动作产生过长 token 序列的问题。方法先对动作块做离散余弦变换，把平滑轨迹能量集中到低频系数，再量化并用 BPE 压缩。

相较逐时刻、逐维度离散，FAST 用更少 token 表示长动作块，使自回归 VLA 能在有限上下文内处理高频控制。动作恢复则执行逆变换得到连续轨迹。

评价 FAST 不能只看 token 压缩率，还要看动作重建误差、接触瞬间的高频损失、词表大小和最终闭环表现。

## GraspNet-1Billion

[GraspNet-1Billion: A Large-Scale Benchmark for General Object Grasping](https://arxiv.org/abs/1912.13470) 建立大规模杂乱场景抓取数据与统一评价。数据包含 RGB-D、点云、对象姿态和大量 6D 抓取标注，覆盖不同相机与未见对象。

<figure class="paper-figure">
  <img src="/blog/images/research/papers/graspnet-architecture.webp" alt="GraspNet-1Billion 数据与六自由度抓取评测框架" loading="lazy" decoding="async" />
  <figcaption>GraspNet-1Billion：从场景采集、密集抓取标注到统一评测的完整流程。图源：<a href="https://arxiv.org/abs/1912.13470">论文原文</a>。</figcaption>
</figure>

GraspNet baseline 先用 PointNet++ 风格网络提取点云特征，预测抓取接近方向，再对候选视角估计角度、深度、宽度和质量。输出不是单一物体姿态，而是场景中的抓取候选集合。

论文的长期价值在 benchmark：抓取质量需要结合摩擦系数、碰撞与对象可见性评价。网络分数只代表学习到的候选质量，实际执行还受夹爪几何和可达性限制。

## Architecture Comparison

| 研究主线 | 代表论文 | 中间表示 | 输出 |
| --- | --- | --- | --- |
| 动作块模仿 | ACT | 连续 future chunk | 关节或末端动作 |
| 生成式策略 | Diffusion Policy/RDT/PI-0 | 去噪轨迹或向量场 | 连续动作序列 |
| 动作 Token | RT-1/RT-2/OpenVLA/FAST | 离散或压缩 token | 自回归动作 |
| 语义技能规划 | SayCan/Code as Policies | 技能或程序 | API 调用序列 |
| 空间推理 | VoxPoser/ReKep | 价值图或关键点约束 | 优化目标 |
| 通用策略 | RT-X/Octo | 跨任务时序 token | 多本体动作 |
| 数据生成 | MimicGen | 对象中心轨迹片段 | 新演示数据 |
| 抓取感知 | GraspNet | 6D 抓取候选 | 位姿、宽度与分数 |

## Reading Order

第一阶段阅读 ACT、Diffusion Policy 和 GraspNet-1Billion，掌握行为克隆、生成式动作和几何抓取三类基础问题。第二阶段阅读 RT-1、RT-2、Open X-Embodiment 与 OpenVLA，理解动作 token、大规模多任务数据和 VLM 迁移。

第三阶段阅读 VIMA、SayCan、PaLM-E、Code as Policies、VoxPoser 与 ReKep，比较多模态 prompt、技能选择、传感器 token、代码和空间约束。第四阶段阅读 MimicGen、Octo、RDT-1B、PI-0 与 FAST，研究数据扩展、通用策略和新一代动作生成架构。

建议使用统一论文卡片记录：任务、输入、动作空间、模型主干、中间表示、训练目标、数据来源、控制频率、评估划分、推理成本和公开资源。高热度模型更新很快，固定字段能避免阅读笔记退化成摘要集合。
