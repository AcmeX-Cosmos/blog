---
title: "ACT 策略源码审计：数据对齐、动作分块与部署一致性"
date: "2026-08-15"
description: "基于本机 RoboTwin/ACT 参考实现进行逐链路审计，定位时序对齐、统计量泄漏、padding 损失和 temporal aggregation 中会直接影响实验结论的问题。"
tags: ["ACT", "模仿学习", "动作分块", "源码审计", "双臂机器人"]
category: "research"
references:
  - title: "Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware"
    meta: "Zhao et al. · RSS 2023"
    url: "https://arxiv.org/abs/2304.13705"
  - title: "RoboTwin 2.0"
    meta: "Generative Digital Twins for Generalizable Robot Learning"
    url: "https://arxiv.org/abs/2506.18088"
  - title: "Diffusion Policy"
    meta: "Chi et al. · RSS 2023"
    url: "https://arxiv.org/abs/2303.04137"
---

## 审计对象与结论边界

本文审计的是本机 `policy/ACT` 目录下的 RoboTwin/ACT 参考实现，不把该目录等同于个人原创项目。目标也不是再介绍一遍 CVAE，而是回答一个更实际的问题：当训练 loss 正常下降、rollout 却不稳定时，错误究竟来自模型能力，还是数据与部署契约已经不一致？

这份实现的主链路是：HDF5 episode -> 随机采样时刻 -> 多相机图像与 `qpos` -> 未来动作块 -> ACT 训练 -> `dataset_stats.pkl` -> 在线动作反归一化 -> 可选 temporal aggregation。逐段检查后，至少有四类问题会污染实验结论，其中前两类甚至会让验证集指标失去解释力。

## 时序对齐不是一个 `-1` 能解决的问题

`EpisodicDataset.__getitem__()` 先取 `qpos[start_ts]`，再决定动作从 `start_ts` 还是 `start_ts - 1` 开始。但局部变量 `is_sim` 被初始化为 `None`，没有从 HDF5 属性中恢复，因此条件分支始终落到 `start_ts - 1`。也就是说，代码注释中的 sim/real 区分在实际执行中不存在。

ACT 学到的是条件分布

$$
p(a_{t:t+H-1}\mid o_t, q_t).
$$

如果首个标签实际是 $a_{t-1}$，模型会被要求用当前观测重建上一时刻动作。对缓慢轨迹，这种错位可能仍产生很低的 L1；对接触、夹爪闭合和换向片段，它会表现为动作滞后。正确做法不是凭经验固定偏移，而是从采集链路定义时间戳：相机曝光、关节状态和下发命令分别记录单调时钟，再用交叉相关或已知脉冲动作估计延迟。

建议先做一个不训练网络的对齐实验：对每条 episode 计算 $\|q_{t+1}-q_t\|$ 与 $\|a_{t+\delta}-q_t\|$，扫描 $\delta\in[-3,3]$；再对夹爪开合边沿单独统计。只有两种证据同时支持同一偏移，才把它写进数据契约。

## 验证集泄漏与变长 episode 偏置

当前 `load_data()` 先对全部 episode 调用 `get_norm_stats()`，之后才建立 80/20 的训练与验证划分。因此验证 episode 的均值和方差已经进入训练预处理。这不是严重的标签泄漏，但会让分布偏移被悄悄削弱，尤其在物体位置、相机曝光或双臂初态按 episode 成组变化时。

第二个问题更隐蔽：为了堆叠不同长度的 episode，统计阶段用末帧重复补齐到最长长度。设第 $i$ 条轨迹长度为 $T_i$、全局最大长度为 $T_{max}$，当前均值实际为

$$
\mu=\frac{\sum_i\left(\sum_{t=1}^{T_i}x_{i,t}+(T_{max}-T_i)x_{i,T_i}\right)}{N T_{max}}.
$$

短轨迹的终止姿态被重复计权。若成功 episode 较短且终点都在收纳位置，动作均值会系统性向终止状态偏移。统计量应只在训练 episode 的有效帧上累计 `sum`、`sum_sq` 和 `count`，无需先 pad。

## Padding 损失的分母也要 masked

实现先将 padding 位置的 L1 乘零，再对完整 `[B,H,D]` 张量调用 `.mean()`。这意味着有效动作越短，loss 数值越小。正确的 masked L1 应写成

$$
\mathcal L_{L1}=
\frac{\sum_{b,t,d}m_{b,t}|a_{b,t,d}-\hat a_{b,t,d}|}
{D\sum_{b,t}m_{b,t}+\epsilon},
$$

而不是除以固定的 $BHD$。否则不同 `chunk_size`、不同 episode 长度的实验不能直接比较，KL 权重的有效比例也随 padding 率变化。

## Temporal aggregation 的两个实现陷阱

在线类为每次预测保存一个 `[max_timesteps, max_timesteps + H, D]` 张量。默认 `max_timesteps=3000`、`D=14` 时，仅动作缓存约占 500 MB FP32 显存，而真正需要保留的只是最近 $H$ 个 chunk，可以改成环形缓冲区。

另一个问题是用 `torch.all(actions_for_curr_step != 0, axis=1)` 判断该槽位是否写入。零是合法的归一化动作，特别是静止关节，因此“数据值”不能兼任“有效位”。需要独立布尔 mask。聚合权重也应明确新旧方向：

$$
\bar a_t=\frac{\sum_{j=0}^{H-1}m_j\exp(-k\Delta_j)a_t^{(j)}}
{\sum_{j=0}^{H-1}m_j\exp(-k\Delta_j)},
$$

其中 $\Delta_j$ 是预测距当前时刻的年龄，而不是依赖张量返回顺序的隐式索引。

## 训练与部署一致性清单

当前训练入口保存 `policy_best.ckpt`，在线 `ACT` 类默认寻找 `policy_last.ckpt`；一个文件名差异就可能让部署在没有加载权重的情况下继续运行。图像链路同样需要显式断言：训练侧做 `uint8 -> /255 -> ImageNet Normalize`，部署侧在 `encode_obs()` 中提前 `/255`，后续不应再次缩放。

部署前至少应让程序主动拒绝以下状态：checkpoint 缺失或存在 missing keys；统计量维度不等于 `qpos/action` 维度；相机名称或顺序与训练配置不一致；输入像素范围不在 `[0,1]`；控制频率与采集频率不一致；episode reset 后 aggregation 缓存未清空。

## 能产出结论的实验矩阵

先固定数据划分并保存 episode ID，再比较 `H={1,20,50,100}`、是否聚合、单相机/三相机三个变量。每组至少报告任务成功率、首次接触时间误差、夹爪闭合边沿误差、关节 jerk、推理延迟 P50/P95，以及按失败阶段分解的比例。

最重要的对照不是“ACT 对 ACT”，而是解析抓取基线。GraspNet + 规划器提供几何可解释的成功下界，ACT 提供从演示中学习接触与时序的能力。只有在相同场景划分、相同执行器约束下比较，两条路线的差异才构成有价值的研究结果。
