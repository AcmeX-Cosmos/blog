---
title: "EKF 多传感器融合：IMU + 视觉的鲁棒目标跟踪"
date: "2025-01-10"
description: "在机器人目标跟踪中，如何融合 IMU 姿态数据和视觉检测结果，使用扩展卡尔曼滤波实现平滑稳定的目标状态估计。"
tags: ["EKF", "ROS2", "多传感器融合", "跟踪", "C++"]
category: "tech"
references:
  - title: "卡尔曼滤波与组合导航原理（第 3 版）"
    meta: "秦永元, 张洪钺, 汪叔华. 西北工业大学出版社, 2015"
  - title: "最优状态估计：卡尔曼、H∞及非线性滤波"
    meta: "D. 西蒙. 张勇刚, 李宁, 奔粤阳译. 国防工业出版社, 2013"
---

## 问题描述

在 RoboMaster 比赛中，敌方装甲板的视觉检测存在诸多挑战：
- 目标快速机动导致运动模糊
- 短暂遮挡导致检测丢失
- 单帧检测噪声导致位姿抖动

单纯依赖视觉检测无法满足射击精度要求，需要引入 IMU 数据进行多传感器融合。

## 系统建模

### 状态向量

我们定义目标的状态向量为：

```
x = [px, py, pz, vx, vy, vz, ax, ay, az]^T
```

其中 `p` 为位置，`v` 为速度，`a` 为加速度。

### 运动模型

使用匀加速模型（CA Model）：

```cpp
// 状态转移矩阵 (3D CA Model)
Eigen::Matrix<double, 9, 9> F = Eigen::Matrix<double, 9, 9>::Identity();

// 位置更新
F.block<3,3>(0, 3) = dt * Eigen::Matrix3d::Identity();
F.block<3,3>(0, 6) = 0.5 * dt * dt * Eigen::Matrix3d::Identity();

// 速度更新
F.block<3,3>(3, 6) = dt * Eigen::Matrix3d::Identity();
```

### 观测模型

```cpp
// 观测矩阵：视觉检测提供位置观测，IMU 提供加速度观测
Eigen::Matrix<double, 6, 9> H = Eigen::Matrix<double, 6, 9>::Zero();
H.block<3,3>(0, 0) = Eigen::Matrix3d::Identity();  // 视觉位置
H.block<3,3>(3, 6) = Eigen::Matrix3d::Identity();  // IMU 加速度
```

## EKF 实现

```cpp
class EKFTracker {
public:
    void predict(double dt) {
        // 状态预测
        x_ = F_ * x_;

        // 协方差预测
        P_ = F_ * P_ * F_.transpose() + Q_;
    }

    void update(const Eigen::Vector3d& visual_pos, const Eigen::Vector3d& imu_accel) {
        Eigen::Matrix<double, 6, 1> z;
        z.head<3>() = visual_pos;
        z.tail<3>() = imu_accel;

        // 卡尔曼增益
        Eigen::Matrix<double, 9, 6> K =
            P_ * H_.transpose() * (H_ * P_ * H_.transpose() + R_).inverse();

        // 状态更新
        x_ = x_ + K * (z - H_ * x_);

        // 协方差更新 (Joseph form, 保证数值稳定性)
        Eigen::Matrix9d I = Eigen::Matrix9d::Identity();
        P_ = (I - K * H_) * P_ * (I - K * H_).transpose() + K * R_ * K.transpose();
    }

private:
    Eigen::Matrix<double, 9, 1> x_;  // 状态
    Eigen::Matrix<double, 9, 9> P_;  // 协方差
    Eigen::Matrix<double, 9, 9> F_;  // 状态转移
    Eigen::Matrix<double, 6, 9> H_;  // 观测矩阵
    Eigen::Matrix<double, 9, 9> Q_;  // 过程噪声
    Eigen::Matrix<double, 6, 6> R_;  // 观测噪声
};
```

## 噪声调参

这是实际部署中最关键的一步：

| 参数 | 物理意义 | 调参策略 |
|------|---------|---------|
| Q（过程噪声） | 信任模型的置信度 | 目标机动性高 → 增大 Q |
| R_vision（视觉噪声） | 视觉检测的信任度 | 检测距离远 → 增大 R |
| R_imu（IMU噪声） | IMU 的信任度 | 剧烈振动 → 增大 R |

## 效果对比

融合后的跟踪效果显著提升：
- **平滑性**：输出轨迹无明显抖动
- **鲁棒性**：短暂遮挡（<200ms）几乎不影响跟踪结果
- **预测能力**：即使检测丢失，滤波器也能预测后续几帧的目标位置

EKF 多传感器融合是我们在全国赛中实现稳定自动瞄准的关键技术之一。
