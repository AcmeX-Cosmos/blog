---
title: "打哪块板、什么时候开火：装甲板选择与命中判据"
date: "2025-08-15"
description: "从整车状态反推四块装甲板位置，按朝向角挑最正的一块，以及 TRACKING_ARMOR / TRACKING_CENTER 双模式在高转速下的切换。"
tags: ["控制", "决策", "RoboMaster", "Eigen", "C++"]
category: "algorithm"
---

## 云台目标选择与开火判据

[9 维 EKF](/blog/ekf9-spintop-tracker) 输出的是整车状态——中心位置、速度、 yaw 、转速、半径。但炮管要瞄的是一块具体的装甲板。从"我知道这辆车在哪、转多快"到"我该把云台指向哪个点、什么时候扣扳机"，中间这层决策是自瞄系统里最靠近比赛结果的一环。

### 1. 问题定义

- **输入**：`TargetSpinTop`（中心位置、速度、 yaw 、w_yaw、r1、r2、dz、armors_count）
- **输出**：`SerialTransmitData`（`yaw_angle`、`pitch_angle`、`fire_flag`、`distance`）
- **约束条件**：转速可达 6 rad/s 以上，此时装甲板正对窗口只有几十毫秒

### 2. 从整车状态反推装甲板位置

四块装甲板均分圆周，第 $k$ 块的朝向角是

$$
\psi_k = \psi + k \cdot \frac{2\pi}{N}, \qquad N \in \{3, 4\}
$$

位置由中心减去半径向量得到：

$$
\mathbf{p}_k = \begin{bmatrix}
x_c - r_k \cos\psi_k \\
y_c - r_k \sin\psi_k \\
z_a + \delta_k
\end{bmatrix}
$$

四装甲板车型的 $r_k$ 和 $\delta_k$ 在两组值之间交替——这正是[跳变处理](/blog/armor-jump-continuous-yaw)里维护的 `r1`/`r2`/`dz`。奇数号板用 `r1` 和 `z_a`，偶数号板用 `r2` 和 `z_a - dz`。三装甲板的前哨站四个量全部相同。

```cpp
std::vector<Eigen::Vector3d> armor_positions = getArmorPositions(
    target_position, spinTop_target_msg_yaw,
    spinTop_target_msg.r1, spinTop_target_msg.r2,
    spinTop_target_msg.dz, spinTop_target_msg.armors_count);
```

### 3. 选哪一块

`selectBestArmor` 的判据是**朝向角**——装甲板法线与视线方向的夹角越小，越正对我方，命中概率越高。夹角过大时装甲板在图像上被压缩成一条线，就算打中也大概率是擦边。

`side_angle` 参数（yaml 给 10.0，代码默认 15.0）就是这个夹角的容忍上限。超出的板直接排除。

选完还要做一次有效性检查：

```cpp
auto chosen_armor_position = armor_positions.at(idx);
if (chosen_armor_position.norm() < 0.1) {
    throw std::runtime_error("No valid armor to shoot");
}
```

范数小于 0.1 m 意味着这块板算到了炮口跟前，物理上不可能——说明上游状态已经错了。这里选择抛异常而不是硬打，由节点侧捕获后清空指令：

```cpp
catch (const std::exception& e) {
    RCLCPP_ERROR(this->get_logger(), "Solver error: %s", e.what());
    vision_control_msg_.yaw_angle = 0;
    vision_control_msg_.pitch_angle = 0;
    vision_control_msg_.distance = -1;
    vision_control_msg_.fire_flag = 0x00;
    vision_control_msg_.find_flag = 0x00;
}
```

`distance = -1` 是给电控的哨兵值，操作手界面据此显示"无效"而不是"距离 0 米"。

### 4. 双模式：跟板还是跟中心

转速太高时，跟着单块装甲板转会让云台疯狂甩动——机械跟不上，而且每次甩到位目标已经转走了。这时更好的策略是**盯着车中心不动，等装甲板自己转到准星上**。

```cpp
enum State { TRACKING_ARMOR, TRACKING_CENTER };

case TRACKING_ARMOR: {
    if (std::abs(spinTop_target_msg.w_yaw) > max_tracking_w_yaw_) {
        overflow_count_++;
    } else {
        overflow_count_ = 0;
    }
    if (overflow_count_ > transfer_thresh_) {
        state = TRACKING_CENTER;
    }
    ...
}
```

`max_tracking_w_yaw_` 是 6.0 rad/s，`transfer_thresh_` 是 5 帧。要连续 5 帧超速才切模式，单帧的转速估计噪声不会导致模式抖动。

反向切换用 `min_switching_v_yaw`（1.0 rad/s）做迟滞——切回跟板模式的阈值远低于切出去的阈值，避免在临界转速附近来回横跳。这是标准的施密特触发器思路。

**这里有个参数名错位**，和 [EKF 那组](/blog/ekf-qr-adaptive-tuning)是同一类问题：

```cpp
max_tracking_w_yaw_ = node_ptr->declare_parameter("gimbal_control.max_tracking_w_yaw", 6.0);
```

```yaml
gimbal_control:
  max_tracking_v_yaw: 6.0     # w vs v
```

`w_yaw` 和 `v_yaw` 差一个字母。这次默认值和 yaml 值恰好都是 6.0，所以行为上看不出区别，但 yaml 那一行实际上是死的——想在赛场上临时调高这个阈值，改了不会生效。

### 5. 开火判据

```cpp
vision_msg.fire_flag = isOnTarget(rpy_[2], rpy_[1], yaw, pitch, distance);
```

判据是：把目标装甲板投影到以当前云台朝向为中心的平面上，看它是否落在一个 `shooting_range_width` × `shooting_range_height` 的窗口内。两个值都是 0.135 m，和小装甲板的实际宽度同量级——意思是"准星要压在板上"，而不是"大致对着车"。

时间维度上还有 `fire_time_interval`（yaml 0.05 s，代码默认 0.2 s）限制最小开火间隔。这个值取决于枪管的射频上限，给小了会让电控收到打不出去的指令。注意这里 yaml 和默认值差了 4 倍，而名字是匹配的——所以生效的是 0.05，射频 20 Hz。

### 6. 调参经验

| 参数 | yaml 值 | 代码默认 | 说明 |
| --- | --- | --- | --- |
| `shooting_range_width` | 0.135 | 0.135 | 开火窗口宽（m） |
| `shooting_range_height` | 0.135 | 0.135 | 开火窗口高（m） |
| `max_tracking_v_yaw` ❌ | 6.0 | 6.0 | 名字错位，yaml 无效 |
| `prediction_delay` | 0.06 | 0.05 | 预测提前量（s） |
| `controller_delay` | 0.06 | 0.05 | 控制器延迟补偿（s） |
| `side_angle` | 10.0 | 15.0 | 装甲板朝向角上限（度） |
| `min_switching_v_yaw` | 1.0 | 1.0 | 切回跟板模式的迟滞下限 |
| `fire_time_interval` | 0.05 | 0.2 | 最小开火间隔（s） |

`side_angle` 从 15° 收到 10° 是赛季中调的——15° 时经常出现"判定命中但实际擦边"，收紧后命中率明显上升，代价是可开火窗口变窄。

### 7. 验证方法

- **静态标定**：车固定在已知位置，检查 `fire_flag` 是否只在准星压住装甲板时为 1
- **模式切换观察**：Foxglove 里同时画 `w_yaw` 和一个自定义的 state 话题，确认切换点符合阈值且无抖动
- **实弹命中率**：不同转速档位各打 50 发，统计命中率——这是唯一真正有说服力的指标

---

延迟补偿链是另一半：[飞行时间与多级延迟](/blog/flight-time-delay-compensation)；弹道本身写在[弹道补偿：查表法与被注释掉的 RK4](/blog/ballistic-rk4-ceres)。
