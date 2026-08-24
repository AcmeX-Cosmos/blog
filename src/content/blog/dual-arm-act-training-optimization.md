---
title: "双臂 ACT 训练优化：从 Expert 可达性到末态评分契约"
date: "2026-08-05"
description: "基于 Tron2 双臂任务，记录 ACT 数据契约、T4 Expert 失败定位、实时放置对齐、采集 I/O 优化与末态分级评测的完整工程链路。"
tags: ["ACT", "Imitation Learning", "Tron2", "RoboTwin", "Curobo", "HDF5", "Evaluation"]
category: "tech"
references:
  - title: "Action Chunking with Transformers"
    meta: "Zhao et al. · Learning Fine-Grained Bimanual Manipulation"
    url: "https://arxiv.org/abs/2304.13705"
  - title: "ACT evaluation implementation"
    meta: "LimX Dynamics · Four-task ACT evaluation suite"
    url: "https://github.com/limxdynamics/troncamp-mani"
  - title: "RoboTwin 2.0"
    meta: "RoboTwin Platform · Generalizable robot learning benchmark"
    url: "https://github.com/RoboTwin-Platform/RoboTwin"
  - title: "AuraVLA"
    meta: "Project implementation · Schema planning and Isaac Sim execution"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 先修数据链路，再调 ACT

公开 ACT 任务套件的四个任务共用 `collect → process → train → evaluate` 流水线：T1 `adjust_bottle`、T2 `grab_roller`、T3 `stack_bowls_two` 和主榜 T4 `stack_bowls_three`。训练使用 Tron2 双臂的 16 维状态与动作，单纯降低 validation loss 不能证明长时序堆叠已经可执行。

这次优化把问题拆成三个边界：

1. Expert 是否能以稳定接触和可达姿态完成任务；
2. 保存到 HDF5 的状态、动作和相机是否满足训练契约；
3. 评测是否只在 episode 末态计算与比赛一致的分数。

任何边界失败都应停止并留下原因，而不是通过增加 epoch 或重复采集掩盖上游问题。

## 16 维数据契约

ACT 配置固定 `state_dim=16`，对应两侧各 `7` 个关节和 `1` 个夹爪通道。右臂、左臂的排列顺序必须在采集、数据转换、训练和部署四处一致；夹爪开度与关节归一化也不能在中间环节重新解释。

视觉输入的顺序同样属于接口的一部分：`head_camera`、`right_wrist_camera`、`left_wrist_camera`。相机张量 shape 即使保持不变，顺序交换也不会触发运行时异常，却会让策略把腕部视角当成全局视角。

训练入口还要验证 action 的 next-state 语义：`action[t]` 应对应从 `qpos[t]` 到 `qpos[t+1]` 的控制目标。NaN/Inf、时间长度不一致、相机帧缺失和截断 episode 进入 rejected manifest，不应靠 mask 静默混入训练集。

## T4 Expert 的失败定位

T4 的主要问题最初不是网络容量，而是第一步 approach 的候选姿态不可达。十个 Seed 的一次诊断中出现 `8` 次 `move_1_approach_failed`、`1` 次 `move_1_grasp_pose_failed` 和 `1` 次 `place_misaligned`，完整成功数为 `0`。因此先改候选生成和日志边界，没有直接修改 ACT 超参数。

### Native-first 候选顺序

原先所有严格 top-down 候选都强制施加腕部内倾，导致本来可达的原生姿态被替换。修复后采用以下顺序：

1. 原生 top-down 姿态；
2. 配置的内倾姿态作为低优先级 fallback；
3. 只有 approach 成功但 grasp-pose 规划失败时，才继续尝试下一个候选；
4. 对自然倾斜的 Curobo 候选放宽轴向过滤，默认允许到 `25°`，硬上限为 `35°`。

候选耗尽后才返回失败，并记录 `move_N_approach_failed` 或 `move_N_grasp_pose_failed`，避免把不同阶段压成一个布尔值。

### 结果边界

日志中 Seed `195` 和 `196` 在旧流程均停在 approach；放宽自然腕轴 fallback 后，两者完成了完整流程。该结果说明修复了 Expert 的候选过滤问题，不等同于 ACT 的 rollout 成功率提升。

## 实时放置对齐与释放稳定

双碗、三碗堆叠的预检目标必须和执行目标使用同一个函数。Move 1 使用固定基准点；Move 2 在放置前读取 Bowl 1 的 live XY；Move 3 读取 Bowl 2 的 live XY，再生成当前层目标。修正量限制在 `0.035 m` 内，超过边界直接拒绝，避免误差补偿变成无界搜索。

释放后保持同一姿态 `50` 个仿真步，再执行原有撤退；撤退先沿 Z 方向抬升 `0.15 m`，随后向 home 位姿做 `0.8` 的线性混合。这样可以把释放沉降与撤退运动分离，减少刚释放的碗被末端再次扫到。

这些约束只改变 Expert 轨迹的可执行性，不改变 ACT 的模型结构。保存的轨迹还应记录 nominal XY、live XY、实际修正量和 release settle 结果，便于排查是抓取、放置还是撤退阶段产生误差。

## 采集 I/O 优化

T4 的瓶颈来自多相机渲染、读回和临时 pickle 写入，而不是日志输出。两路腕部相机和头部相机同时启用时，旧配置 `save_freq=15` 会让完整 Seed `195` 在超过 `300 s` 时仍未结束，并已写入 `708` 个临时帧。

最终配置采用：

| 配置 | 旧值 | 当前值 | 目的 |
| --- | ---: | ---: | --- |
| `save_freq` | `15` | `30` | 减少重复图像读回，同时保留边界帧 |
| `save_video` | `true` | `false`（T4） | 保留 HDF5 RGB，跳过 MP4 编码 |
| approach retries | `3` | `1` | 依靠候选 fallback，避免重复规划同一失败目标 |
| 其他阶段 retries | `3` | `3` | 保留 grasp/lift/place/retreat 的恢复空间 |

Seed `195` 的单次验证结果为成功、`507` 帧、HDF5 `31,304,263` bytes，三路 RGB 均存在且未生成 MP4，耗时 `246.79 s`。相对尚未完成且超过 `300 s` 的旧流程，最多只能表述为已观测到至少 `17.7%` 的耗时下降，不能包装成所有场景的通用加速 benchmark。

## 评测必须与训练解耦

`recipes/eval/act_contract.py` 将评测结果固定为：

```json
{
  "sr": 0.0,
  "n_repeats": 1,
  "n_episodes": 100,
  "per_repeat": [0.0],
  "track": "T4",
  "graded": 0.0
}
```

T1-T3 只输出二元 `sr`，用于顺序解锁；T4 额外输出 `graded`，表示每个 episode 末态的三层堆叠进度均值。评测内核通过 `TASK_BY_TRACK` 固定 track 到 RoboTwin task 的映射，并要求每个 repeat 覆盖相同数量的 Seed，禁止 ragged repeat 被平均成看似合理的数字。

T4 的 `graded_stack_score` 只在 episode 结束时调用一次，读取三只碗的最终位置、桌面高度偏移和双夹爪打开状态。评分按锚点 `C=(0,-0.1)`、层高容差和最小层间距计算 `0、1/3、2/3、1`；不能把逐仿真步分数累加，否则长轨迹会被错误放大。

## Fail-loud 回归边界

评测契约拒绝以下情况：重复 Seed、空 Seed 表、未知 track、非布尔 success、非有限或不在 `[0,1]` 的 graded 值、不同 repeat 的 episode 数量不一致。纯 Python 单元测试覆盖分级评分的层数、锚点、夹爪门控、重叠高度区间和输入校验；GPU/仿真端仍需独立执行真实 rollout。

AuraVLA 的经验可以作为上层系统边界：VLM 只产生经过 Schema 验证的 `pick_and_place` 意图，禁止 `pose`、`trajectory`、`joint_positions` 等底层字段；ACT 则只消费经过数据契约和评测契约筛选的轨迹。两者共同遵循“模型负责泛化，确定性模块负责约束”的分层原则。

## 结论

这次优化没有把“训练更久”当成默认答案，而是先修复 Expert 候选不可达、堆叠目标漂移、观测 I/O 和评分口径四类会污染实验的因素。最终报告必须同时给出数据契约版本、Seed manifest、checkpoint、控制频率、chunk size、相机顺序和末态评分规则；缺少这些条件的成功率只能作为一次运行记录，不能作为模型能力结论。
