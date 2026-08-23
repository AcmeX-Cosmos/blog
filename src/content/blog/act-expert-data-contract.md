---
title: "ACT 双臂操作的数据闭环：从 Expert 可达性到 16 维训练契约"
date: "2026-07-14"
description: "将双臂 Expert 的可达性、接触几何和放置一致性，与 ACT 的状态动作和多相机数据契约统一到同一条可审计链路。"
tags: ["ACT", "双臂机器人", "Motion Planning", "HDF5", "Data Contract"]
category: "tech"
references:
  - title: "Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware"
    meta: "Zhao et al. · RSS 2023"
    url: "https://arxiv.org/abs/2304.13705"
  - title: "Action Chunking with Transformers"
    meta: "ACT policy reference"
    url: "https://arxiv.org/abs/2304.13705"
  - title: "cuRobo"
    meta: "GPU-accelerated robot motion generation"
    url: "https://github.com/NVlabs/curobo"
---

## 问题不是“ACT 学得不够久”

双臂模仿学习最容易被误判的故障，是把执行失败归因于网络容量或训练轮数。实际链路中，Expert 若在不可达姿态、错误接触点或不一致的放置目标上失败，采集到的监督本身就不具备稳定的闭环语义；即使 loss 下降，策略也只是在拟合一组含混的动作标签。

这类问题需要在同一条链路上处理：

```mermaid
flowchart LR
  A[任务参数] --> B[接触与可达性预检]
  B --> C[阶段化 Expert 执行]
  C --> D[物理终态校验]
  D --> E[HDF5 数据契约]
  E --> F[ACT 训练]
```

预检负责拒绝明显不可行的目标，终态校验负责判断轨迹是否值得保存，数据契约则负责保证保存后的轨迹仍然具有统一语义。三者缺一不可。

## 先固定接触几何，再优化姿态

在双臂滚筒抓举中，自由接触点搜索在固定十个 Seed 上得到 `0/10`。失败并非 planner 没有找到局部 IK 解，而是两只夹爪没有形成可抬升的受力关系。将左右接触端点固定到物体几何两侧，把 pre-grasp 距离缩短至 `0.03 m`、夹爪目标调整为 `0.08` 后，候选才进入可执行范围。

这给出一个可复用的候选生成顺序：先依据物体主轴和双臂操作空间确定接触区域，再做单臂 IK、碰撞和开度检查；只有两侧同时通过，才进入闭链抬升规划。执行前仍需读取夹爪接触状态，因为规划成功不能替代物理接触成功。

## 预检目标必须等于执行目标

双碗堆叠曾出现“预检通过、运行失败”：预检使用固定高度，执行时却根据当前末端高度重新构造 approach 点，两个模块检查的不是同一个目标。修复方式是让两者共享唯一的目标生成函数，并在每次放置前重新读取支撑碗位姿：

```python
def build_place_target(support_pose, bowl_height):
    return Pose(
        position=[support_pose.p[0], support_pose.p[1],
                  support_pose.p[2] + bowl_height],
        orientation=support_pose.q,
    )

target = build_place_target(live_support_pose, BOWL_HEIGHT)
preflight.check(target)
robot.execute(target)
```

实时 XY 对齐把前序误差限制在当前支撑层，而不是让初始位姿误差沿堆叠层数累积。T4 还将抓取、抬升、预放置、精确放置、释放、稳定等待和回撤拆成独立阶段；approach、grasp、lift、place 的失败分别对应不同修复动作，不能用统一 retry 代替。

## 轨迹质量是训练契约的一部分

Tron2 双臂的状态和动作统一为 `16 = 2 × (7 arm DoF + 1 gripper)`，维度顺序固定为右臂 8 维、左臂 8 维；关节位置归一化到 `[-1, 1]`，夹爪开度使用 `[0, 1]`。三路视觉输入固定为 `head_camera`、`right_wrist_camera`、`left_wrist_camera`。

这些定义必须在采集、转换、训练和部署四处一致。相机顺序尤其危险：张量 shape 不变时，顺序错误不会触发异常，却会把全局视角和腕部视角的语义互换。

ACT 标签采用 next-state 语义，即 `action[t]` 驱动系统从 `qpos[t]` 到 `qpos[t+1]`。训练前应扫描 `delta in [-3, 3]` 的对齐误差，并对夹爪开合边沿单独检查；不能仅凭 loss 判断是否存在一个时间步偏移。

HDF5 入口至少拒绝以下情况：rank 或时间长度不一致、最后一维不是 16、NaN/Inf、相机帧数不齐、episode 截断。归一化统计量只从训练 episode 的有效帧计算，避免验证集泄漏和短轨迹终帧重复计权。

## 结果如何解释

报告中的 T4 Expert 生产样本成功率约为 `14%–20%`，成功 Seed 195 用时 `246.79 s`，相比旧流程至少减少 `17.7%`。这些是 Expert 采集指标，不是 ACT rollout SR。它们能说明采集链路得到改善，但不能直接证明策略泛化。

因此，训练前最值得投入的工作不是继续堆 epoch，而是把“可执行目标、物理成功、动作语义、相机顺序”变成机器可检查的契约。契约通过后，超参数实验才拥有可比较的前提。

