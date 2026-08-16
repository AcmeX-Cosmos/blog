---
title: "提前量的四笔账：飞行时间与多级延迟补偿"
date: "2025-08-08"
description: "从图像时间戳到弹丸命中，中间叠了消息延迟、飞行时间、预测延迟、控制器延迟四层，以及控制器延迟为什么被算了两次。"
tags: ["控制", "延迟补偿", "RoboMaster", "Eigen", "C++"]
category: "algorithm"
---

## 运动目标的提前量解算 - 2025-10-04

[装甲板选择](/blog/gimbal-armor-selection-fire)解决了"打哪块"，[弹道补偿](/blog/ballistic-rk4-ceres)解决了"抬多高"。但这两步算的都是**目标此刻在哪**——而弹丸打到那里时，目标早就走了。

一辆步兵横向速度 2 m/s，5 m 距离飞行时间 0.21 s，位移 42 cm。装甲板宽 13.5 cm。不算提前量，横向移动的目标基本打不中。

### 1. 问题定义

- **输入**：`TargetSpinTop`（含 `header.stamp`、position、velocity、 yaw 、w_yaw）
- **输出**：外推到"弹丸到达时刻"的目标状态
- **约束条件**：每一层延迟都要能单独标定，因为它们的来源完全不同

### 2. 四笔账分别是什么

从相机曝光到弹丸命中，时间轴上依次是：

$$
\Delta t_{\text{total}} = \underbrace{t_{\text{now}} - t_{\text{stamp}}}_{\text{①流水线耗时}}
+ \underbrace{t_{\text{flight}}}_{\text{②飞行时间}}
+ \underbrace{t_{\text{pred}}}_{\text{③预测延迟}}
+ \underbrace{t_{\text{ctrl}}}_{\text{④控制器延迟}}
$$

**① 流水线耗时**是实测量，不是参数。`header.stamp` 来自[相机回调](/blog/huaray-camera-ros2-driver)，一路经检测、PnP、BA、EKF 传下来，到云台控制这里减一下当前时间就是这一帧真实走了多久。它随负载波动，所以必须每帧算而不能写死。

**② 飞行时间**由距离和初速决定，`getFlyingTime()` 算出来。

**③ 预测延迟**（`prediction_delay = 0.06`）补的是从这里到指令真正发出串口的那段。

**④ 控制器延迟**（`controller_delay = 0.06`）补的是电控收到指令后云台机械响应的时间。

③ 和 ④ 分开是有意义的：前者是软件链路，换个 QoS 或者改个发布频率就会变；后者是机械特性，换电机才会变。混成一个参数的话，标定时无法归因。

### 3. 工程实现

```cpp
Eigen::Vector3d target_position(msg.position.x, msg.position.y, msg.position.z);
double target_yaw = msg.yaw;

this->current_flight_time_ = getFlyingTime(target_position);

double dt = (current_time - rclcpp::Time(msg.header.stamp)).seconds()
          + this->current_flight_time_
          + prediction_delay_;

target_position.x() += dt * msg.velocity.x;
target_position.y() += dt * msg.velocity.y;
target_position.z() += dt * msg.velocity.z;
target_yaw          += dt * msg.w_yaw;
```

位置按匀速外推，yaw 按匀角速度外推。**yaw 外推是这里的关键**——目标转 0.2 s 后是哪块装甲板正对我方，完全由 `w_yaw * dt` 决定。位置外推错了是偏几厘米，yaw 外推错了是打到隔壁那块板上。

外推完再算装甲板位置和选板，所以整条链路选的是"弹丸到达时**将会**正对我方的那块板"，而不是"现在正对的那块"。

### 4. 控制器延迟被算了两次

`TRACKING_ARMOR` 分支里还有第二次外推：

```cpp
case TRACKING_ARMOR: {
    ...
    // If isOnTarget() never returns true, adjust controller_delay to force the gimbal to move
    if (controller_delay_ != 0) {
        target_position.x() += controller_delay_ * msg.velocity.x;
        target_position.y() += controller_delay_ * msg.velocity.y;
        target_position.z() += controller_delay_ * msg.velocity.z;
        target_yaw          += controller_delay_ * msg.w_yaw;
        armor_positions = getArmorPositions(target_position, target_yaw, ...);
    }
}
```

在已经外推了 `dt`（含 `prediction_delay`）的基础上，又加了一次 `controller_delay`，然后**重算一遍装甲板位置**。

注释写得很直白：`If isOnTarget() never returns true, adjust controller_delay to force the gimbal to move`。这不是在补偿物理延迟，而是在**强迫云台动起来**。

背后的问题是这样的：开火判据要求准星压在装甲板上（[窗口 0.135 m](/blog/gimbal-armor-selection-fire)）。如果云台的位置环有稳态误差，准星会稳定地停在目标旁边一点点，`isOnTarget()` 永远返回 false，一发都打不出去。人为多加一个提前量，等于把目标点往前推，逼着云台越过那个死区。

这是典型的"用一个补偿参数掩盖另一个环节的缺陷"。正确的做法是去修云台位置环，或者给开火判据加一个死区容忍。但赛场上没有时间改电控固件，加个参数是最快的止血方式——代价是 `controller_delay` 从此不再是一个有物理意义的量，它的值取决于云台的稳态误差有多大。

`TRACKING_CENTER` 分支没有这段，因为那个模式下云台本来就基本不动，不存在跟不上的问题。

### 5. 调参经验

| 参数 | yaml 值 | 代码默认 | 说明 |
| --- | --- | --- | --- |
| `prediction_delay` | 0.06 | 0.05 | 软件链路延迟，yaml 生效 |
| `controller_delay` | 0.06 | 0.05 | 云台机械响应，兼作死区补偿 |

标定顺序很重要，反了会互相污染：

**先标 `prediction_delay`。** 让目标静止，只看指令从发出到串口上出现的时间差，用逻辑分析仪抓。这个量和目标运动无关，可以单独测。

**再标 `controller_delay`。** 目标匀速横移，观察弹着点系统性地落在目标前面还是后面。落后就加，超前就减。

**最后检查 ①。** `ros2 topic delay /spin_top_topic` 看流水线耗时的分布。如果它的抖动比 ③④ 加起来还大，说明瓶颈在链路而不在补偿参数，调 ③④ 是白费力气。

#### 坑点

**`dt` 里的 ① 项可能为负。** 如果电脑时钟和相机时间戳源不同步，`current_time - header.stamp` 会算出负值，外推方向反了。代码里没有钳制。这在单机上不会发生，但如果哪天把相机换成网络相机（PTP 同步），就要加 `std::max(0.0, ...)`。

**匀速外推在 0.3 s 尺度上开始失真。** 目标加速或转向时，线性外推的误差随 $\Delta t^2$ 增长。当前总延迟在 0.15–0.3 s 量级，勉强够用；如果距离更远（飞行时间更长），就该考虑用 EKF 状态里的加速度项——但当前模型是匀速的，没有加速度状态。

### 6. 验证方法

- **静止目标**：所有外推项应该不改变目标位置（速度为零），弹着点偏差反映的是纯弹道补偿误差
- **匀速横移**：这是唯一能分离出提前量误差的场景。目标以已知速度横移，弹着点相对装甲板中心的水平偏差 = 提前量误差 × 速度
- **陀螺目标**：检查选中的装甲板编号是否和弹着时刻实际正对的那块一致——这个只能靠高速摄像回放确认
- **时间戳链路**：`ros2 topic delay` 逐级测 `/image_raw`、`/armor_bapose_info`、`/spin_top_topic`，找出耗时最大的一段

**评价指标**：横移目标的水平弹着偏差、流水线耗时的均值与 95 分位数。

---

系统层的兜底机制：[心跳看门狗与 tmux 自动重启](/blog/guard-dog-heartbeat-tmux)。
