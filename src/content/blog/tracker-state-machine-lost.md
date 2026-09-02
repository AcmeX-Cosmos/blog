---
title: "跟踪状态机：一帧里跑了两次 EKF 更新"
date: "2025-08-31"
description: "PATROL / DETECTING / TRACKING / TEMP_LOST 四态迁移与丢帧阈值的动态换算，以及排查跟踪\"过于跟手\"时挖出的回调重复调用。"
tags: ["EKF", "状态机", "调试", "ROS2", "C++"]
category: "algorithm"
---

## 跟踪状态迁移与重复更新

[9 维 EKF](/blog/ekf9-spintop-tracker) 只负责\"给定观测算状态\"。什么时候该开始跟、什么时候算丢了、丢多久该放弃，是外面一层状态机的事。这层逻辑不难，但它出问题时症状很隐蔽——跟踪看起来是好的，只是\"有点太跟手了\"。

### 1. 现象描述

**预期行为**：目标做匀速直线运动时，`spin_top_topic` 里的 `velocity` 应该平滑收敛到真实速度。

**实际行为**：速度估计偏大，而且对观测噪声的响应比预期快得多——单帧观测跳一下，速度立刻跟着跳。调小 `sigma2_q` 想让它更信模型，修正参数接入后症状缓解了，但仍然比理论值\"活泼\"。相关的融合策略见[EKF 多传感器融合](/blog/ekf-multisensor-fusion)。

**复现条件**：任何跟踪状态下都存在，不依赖目标类型。

### 2. 状态机本身

先把正常逻辑写清楚。四个状态：

```cpp
enum State { PATROL, DETECTING, TRACKING, TEMP_LOST } tracker_state;
```

| 状态 | 含义 | 出口 |
| --- | --- | --- |
| `PATROL` | 没有目标，云台巡逻 | 收到有效装甲板 → `DETECTING` |
| `DETECTING` | 疑似目标，攒置信度 | 连续命中 > `tracking_thresh` → `TRACKING`；一次未命中 → 退回 `PATROL` |
| `TRACKING` | 稳定跟踪，向云台发指令 | 未命中 → `TEMP_LOST` |
| `TEMP_LOST` | 短暂丢失，仍用模型外推 | 重新命中 → `TRACKING`；连续丢 > `lost_thres` → `PATROL` |

迁移代码：

```cpp
if (tracker_state == DETECTING) {
    if (matched) {
        detection_count_++;
        if (detection_count_ > tracking_thresh) {
            detection_count_ = 0;
            tracker_state = TRACKING;
        }
    } else {
        detection_count_ = 0;          // 一票否决
        tracker_state = PATROL;
    }
}
else if (tracker_state == TRACKING) {
    if (!matched) { tracker_state = TEMP_LOST; lost_count_++; }
}
else if (tracker_state == TEMP_LOST) {
    if (!matched) {
        lost_count_++;
        if (lost_count_ > lost_thres) { lost_count_ = 0; tracker_state = PATROL; }
    } else {
        tracker_state = TRACKING; lost_count_ = 0;
    }
}
```

两处设计值得单独说。

**`DETECTING` 是一票否决，`TEMP_LOST` 是累计计数。** 进入跟踪要连续 5 帧命中，一次失败就清零重来；而退出跟踪允许连续丢若干帧。这个不对称是刻意的——误跟一个假目标的代价（云台甩过去、开火）远高于晚跟半帧。

**`lost_thres` 是帧数，但配置项是秒。** 帧率会随光照变化（曝光时间变长则帧率降低），写死帧数在暗光下会变成\"丢 5 帧就放弃\"，实际只过了 0.1 秒。所以每帧按当前 `dt_` 换算：

```cpp
tracker_->lost_thres = std::abs(static_cast<int>(lost_time_thresh_ / tracker_->dt_));
```

`lost_time_thresh` 在节点里声明默认 0.3，yaml 给的是 1.0，名字匹配所以 yaml 生效——允许丢 1 秒。对陀螺目标来说这个值偏大也没关系，因为 EKF 在 `TEMP_LOST` 期间还在按模型外推，云台不会失去目标。

### 3. 排查过程

**假设 1：关联门限太松，噪声观测被当成有效匹配。** 打印 `info_position_diff`，正常帧在 0.02–0.05 m，远低于 0.2 m 的门限。结论：**不成立**。

**假设 2：`dt_` 算错了，导致预测步走过头。** `update_dt()` 用 `(current_time_ - previous_time_).seconds()`，而 `current_time_` 取自 `armor_bapose_msg_->header.stamp`。检查发现 `previous_time_` **从未被赋值**——搜遍 `spinTop_tracker.cpp` 和 `vision_tracker_node.cpp`，只有声明和读取，没有写入。结论：**成立，是问题之一**。

**假设 3：一帧里 EKF 被更新了不止一次。** 回头读 `solver_callback` 的控制流，发现了这个：

```cpp
if (tracker_->tracker_state == SpinTopTracker::PATROL) {
    tracker_->init(...);
    spinTop_target_msg.tracking = false;
}
else {
    tracker_->update_dt();
    tracker_->lost_thres = std::abs(static_cast<int>(lost_time_thresh_ / tracker_->dt_));
    tracker_->update(armor_bapose_msg_, odom_measurement_msg_);      // ← 第一次

    const auto &state = tracker_->target_state;                       // 声明后未使用
    if (tracker_->tracker_state == SpinTopTracker::PATROL) {
        tracker_->init(...);
        spinTop_target_msg.tracking = false;
    }
    else {
        tracker_->update_dt();
        tracker_->lost_thres = std::abs(static_cast<int>(lost_time_thresh_ / tracker_->dt_));
        tracker_->update(armor_bapose_msg_, odom_measurement_msg_);   // ← 第二次，同一帧同一观测
        ...
    }
}
```

外层 `else` 分支里完整地写了一遍状态判断和更新，内层 `else` 又原样写了一遍。结论：**成立，是主因**。

### 4. 根因分析

外层那段是内层逻辑的残留副本——大概是重构时把整块 `if/else` 往里包了一层，忘了删掉外面的。编译器不会报，因为两段代码都合法；`const auto &state` 声明后没用倒是会触发未使用变量告警，但项目里告警太多，淹掉了。

后果是每帧做了**两次完整的 predict + update**：

- **predict 走了两遍**，$P \leftarrow FPF^\top + Q$ 执行两次，过程噪声被注入双份。协方差比应有值大，卡尔曼增益随之偏大——这就是\"太跟手\"的直接来源。
- **同一个观测被用了两次**，等价于把这一帧的信息量当成两帧。滤波器对单帧噪声的抵抗力下降一半。
- 第二次 predict 用的 `dt_` 和第一次相同（`previous_time_` 从没更新过，两次 `update_dt()` 算出一样的值），所以状态被沿着速度方向多推了一个 $\Delta t$。速度估计偏大正是这么来的。

三个效应叠加，表现就是\"能跟，但比理论上更抖、速度偏高\"。

### 5. 解决方案

删掉外层那一段重复的 `update_dt / lost_thres / update`，只保留内层。同时把 `previous_time_` 的赋值补上：

```cpp
void SpinTopTracker::update_dt() {
    dt_ = (current_time_ - previous_time_).seconds();
    previous_time_ = current_time_;        // 补上这行
}
```

不补的话 `dt_` 会一直是\"当前帧时间戳减去一个未初始化的 `rclcpp::Time`\"。`rclcpp::Time` 默认构造是 0，所以 `dt_` 实际等于自纪元起的秒数——一个巨大的数值。$Q$ 里有 $\Delta t^4$ 项，这会让过程噪声大到离谱，滤波器完全退化成\"只信观测\"。

这也解释了为什么调 $Q$ 的效果一直不明显：$\Delta t$ 已经把 $\sigma^2$ 的影响冲得无关紧要了。两个 bug 互相掩盖，是这次排查绕了远路的原因。

### 6. 验证结果

- **每帧更新次数**：在 `exkalman_update` 里加计数，对照 `image_raw` 帧数，比值应为 1.00
- **`dt_` 合理性**：打印出来应在 0.016–0.033 s（对应 30–60 FPS），任何数量级异常都说明时间戳链路有问题
- **速度估计对照**：让目标以已知速度（推着走，用卷尺和秒表）直线运动，比较 `velocity` 与真值
- **状态迁移日志**：把四态迁移打成日志，正常跟踪时应该长时间停在 `TRACKING`，偶尔闪进 `TEMP_LOST` 又回来。频繁在 `DETECTING` 和 `PATROL` 之间振荡说明 `tracking_thresh` 或关联门限需要重调

**评价指标**：单帧更新次数、速度估计 RMSE、状态迁移频次。

---

跟踪稳了才谈得上打：[装甲板选择与开火判据](/blog/gimbal-armor-selection-fire)。
