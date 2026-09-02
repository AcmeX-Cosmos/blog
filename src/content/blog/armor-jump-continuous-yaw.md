---
title: "装甲板跳变：yaw 折叠与半径互换"
date: "2025-08-13"
description: "陀螺目标切换装甲板时状态被拽飞的根因排查——从 ±π 折叠、双半径互换到高度差补偿，以及跳变后状态错误的兜底重置。"
tags: ["EKF", "状态估计", "调试", "RoboMaster", "C++"]
category: "algorithm"
references:
  - title: "rm_vision"
    meta: "华南师范大学 陈君"
    url: "https://gitlab.com/rm_vision"
  - title: "卡尔曼滤波与组合导航原理（第 3 版）"
    meta: "秦永元, 张洪钺, 汪叔华. 西北工业大学出版社, 2015"
---

## 装甲板切换导致跟踪发散

[9 维 EKF](/blog/ekf9-spintop-tracker) 把整车建成一个旋转刚体之后，理论上装甲板轮换只是换了个观测点，模型本身是连续的。实际跑起来不是这样——每次装甲板切换，估计出来的车中心会往外弹一下，严重时直接发散到几米开外。

### 1. 现象描述

**预期行为**：陀螺旋转过程中，`spin_top_topic` 里的 `position` 应该是一条平滑曲线（车在原地转就该基本不动）。

**实际行为**：每约 90° 转角处，`position.x` / `position.y` 出现一次阶跃，幅度 0.2–0.5 m，之后缓慢收敛，还没收敛完下一次跳变又来了。转速越高越糟，到 5 rad/s 以上基本就是一条锯齿。

**复现条件**：目标持续小陀螺，转速 > 2 rad/s，四装甲板车型（步兵）。前哨站（三装甲板）症状轻一些。

### 2. 排查过程

**假设 1：关联门限太松，把别的车的装甲板关联进来了。** 验证方法是打印 `info_position_diff` 和被关联的 `armor_pattern_idx`。结论：**不成立**。跳变时 id 始终一致，位置差也在门限内。

**假设 2：yaw 在 ±π 处折叠。** `tf2::Matrix3x3::getRPY` 返回的 yaw 落在 $(-\pi, \pi]$。目标转过 180° 时，观测 yaw 从 $+3.14$ 突变到 $-3.14$，而状态里的 $\psi$ 是连续累积的。此时 $z_3 - h_3(\mathbf{x}) \approx -6.28$，这个巨大的创新乘上卡尔曼增益，会把中心和半径一起拽飞。验证方法是把 `measured_yaw` 和 `target_state(6)` 同时画到 Foxglove 上 —— 折叠点和跳变点完全重合。结论：**成立，是主因之一**。

**假设 3：四块装甲板的半径和高度不相同。** 步兵车前后两块装甲板离旋转中心更近、装得更低，左右两块更远更高。模型里只有一个 $r$ 和一个 $z_a$，切换装甲板时这两个量的真值是阶跃的，但滤波器会把它当成噪声慢慢跟——跟的过程中中心估计被带偏。验证方法是量了一下实车尺寸，前后 $r \approx 0.20$ m、左右 $r \approx 0.28$ m。结论：**成立，是主因之二**。

### 3. 根因分析

两个原因叠在一起：yaw 的**表示不连续**，加上模型状态与物理真值的**阶跃失配**。

第一个是纯粹的表示问题。EKF 的更新式 $\mathbf{x} \leftarrow \mathbf{x} + K(\mathbf{z} - h(\mathbf{x}))$ 隐含假设创新量是小量，而角度折叠制造了一个 $2\pi$ 的伪创新。

第二个是建模粒度问题。把四块几何参数不同的装甲板压进一组 $(r, z_a)$，切换瞬间必然失配。要么把状态扩展成 $(r_1, r_2, z_1, z_2)$ 全部参与滤波，要么在切换时**手工交换**——后者简单得多，因为对角的两块板参数相同，只有两组值需要维护。

### 4. 解决方案

#### 4.1 yaw 连续化

在观测转换的入口就把角度展开成 $(-\infty, +\infty)$：

```cpp
double SpinTopTracker::orientationToYaw(const geometry_msgs::msg::Quaternion &q) {
    tf2::Quaternion tf_q;
    tf2::fromMsg(q, tf_q);
    double roll, pitch, yaw;
    tf2::Matrix3x3(tf_q).getRPY(roll, pitch, yaw);

    // Make yaw change continuous (-pi~pi to -inf~inf)
    yaw = last_yaw_ + angles::shortest_angular_distance(last_yaw_, yaw);
    last_yaw_ = yaw;
    return yaw;
}
```

`angles::shortest_angular_distance(a, b)` 返回从 $a$ 到 $b$ 的最短有向角差，值域 $[-\pi, \pi]$。加到 `last_yaw_` 上就得到了连续展开的角度。这三行是整个跟踪器里性价比最高的代码。

副作用是 `last_yaw_` 会随时间单调增长——目标一直转的话，几分钟后 $\psi$ 能到几百弧度。`double` 的精度在这个量级完全够用，但如果换成 `float` 就要小心了。

#### 4.2 双半径互换与高度差

```cpp
void SpinTopTracker::handleArmorJump(const vision_interfaces::msg::OdomMeasurement &current_armor) {
    double last_yaw = target_state(6);
    double yaw = orientationToYaw(current_armor.pose.orientation);

    if (abs(yaw - last_yaw) > 0.4) {
        target_state(6) = yaw;
        // Only 4 armors has 2 radius and height
        if (tracked_armors_count == ArmorsCount::NORMAL_4) {
            dz = target_state(4) - current_armor.pose.position.z;
            target_state(4) = current_armor.pose.position.z;
            std::swap(target_state(8), another_r);
        }
    }
    ...
}
```

`another_r` 是影子状态——它不参与 EKF 的预测和更新，只是把\"另一组装甲板的半径\"存着。切换时和 `target_state(8)` 对调，等于瞬间把模型切到正确的几何参数上，不需要滤波器慢慢收敛。

`dz` 记录两组装甲板的高度差，同样是切换时更新。它随 `TargetSpinTop` 一起发布给云台控制，用于反推另外三块装甲板的位置。

三装甲板的前哨站被显式排除在外——它的三块板半径高度都一样，交换反而会引入错误。

`0.4` rad 这个阈值卡在\"正常帧间yaw变化\"和\"装甲板切换\"之间。四装甲板车型相邻板相差 90°（1.57 rad），而单帧正常变化在 5 rad/s 转速、60 FPS 下约 0.08 rad，中间留了 5 倍余量。

#### 4.3 状态错误兜底

交换完还要检查一次几何自洽：

```cpp
Eigen::Vector3d current_p(p.x, p.y, p.z);
Eigen::Vector3d infer_p = ekf_->getArmorPositionFromState(target_state);

if ((current_p - infer_p).norm() > max_match_distance_) {
    // 状态错误，重置中心位置和速度
    double r = target_state(8);
    target_state(0) = p.x + r * cos(yaw);   // xc
    target_state(1) = 0;                    // vxc
    target_state(2) = p.y + r * sin(yaw);   // yc
    target_state(3) = 0;                    // vyc
    target_state(4) = p.z;                  // za
    target_state(5) = 0;                    // vza
    cout << "armor_solver State wrong!" << endl;
}
```

用当前状态反推装甲板应该在哪，和实测位置比。差太多说明前面的假设全错了（可能换车了、可能中间丢了太多帧），此时不做微调而是**整个重置**——把中心按当前观测重新算，速度清零。

速度清零是保守选择：宁可损失几帧的速度估计，也不要带着一个错误的速度往前外推。

### 5. 验证结果

- **跳变点对齐检查**：Foxglove 同时画 `measured_yaw`、`target_state(6)`、`position.x`。修复后折叠点处 $\psi$ 曲线连续，`position.x` 无阶跃。
- **半径时序**：`r1` / `r2` 应该在两个值之间规律性对跳，跳变频率等于装甲板切换频率。如果看到 $r$ 缓慢漂移而不是对跳，说明 `swap` 没触发。
- **高转速压力测试**：把目标转速从 1 rad/s 逐步加到 6 rad/s，观察中心估计的标准差。修复前在 3 rad/s 就开始发散，修复后 6 rad/s 仍然稳定。
- **`State wrong!` 计数**：正常运行时这行日志应该极少出现。频繁打印说明关联门限或跳变阈值需要重调。

---

噪声矩阵的整定是另一半功课，可参考[EKF 多传感器融合](/blog/ekf-multisensor-fusion)。
