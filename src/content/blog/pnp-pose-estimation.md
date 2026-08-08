---
title: "PnP 位姿解算：从理论到实践"
date: "2025-03-15"
description: "深入理解 PnP (Perspective-n-Point) 问题的数学原理，并通过 OpenCV + Ceres 实现高精度位姿估计。"
tags: ["PnP", "OpenCV", "Ceres", "视觉", "C++"]
category: "research"
---

## 什么是 PnP 问题

PnP（Perspective-n-Point）是计算机视觉中的经典问题：给定 n 个 3D 空间点及其在图像平面上的 2D 投影，求解相机的位姿（旋转矩阵 R 和平移向量 t）。

在 RoboMaster 机器人视觉系统中，PnP 用于从检测到的装甲板灯柱角点推算出装甲板相对于相机坐标系的 6D 位姿，这是后续弹道解算和目标跟踪的基础。

## 数学模型

PnP 的核心是建立 3D-2D 对应关系：

```
s * [u, v, 1]^T = K * [R|t] * [X, Y, Z, 1]^T
```

其中：
- `(u, v)` 是 2D 像素坐标
- `(X, Y, Z)` 是 3D 世界坐标
- `K` 是相机内参矩阵
- `[R|t]` 是待求解的相机位姿
- `s` 是尺度因子

## EPnP 算法

EPnP（Efficient PnP）是当前最常用的解法之一，其核心思想是用 4 个虚拟控制点来表示所有 3D 点：

```cpp
// OpenCV 中的 EPnP 调用
cv::Mat rvec, tvec;
cv::solvePnP(
    objectPoints,    // 3D 点 (装甲板角点)
    imagePoints,     // 2D 点 (图像检测到的角点)
    cameraMatrix,    // 相机内参 K
    distCoeffs,      // 畸变系数
    rvec, tvec,      // 输出：旋转向量和平移向量
    false,           // 不使用外点猜测
    cv::SOLVEPNP_EPNP
);
```

## BA 优化精化

EPnP 给出的结果往往不够精确。在实际系统中，我们使用 Ceres Solver 进行 Bundle Adjustment（BA）优化，将重投影误差作为代价函数：

```cpp
struct ReprojectionError {
    ReprojectionError(const cv::Point2d& observed, const cv::Point3d& world)
        : observed_(observed), world_(world) {}

    template <typename T>
    bool operator()(const T* const rotation, const T* const translation, T* residuals) const {
        // 将世界坐标点通过当前位姿投影到图像平面
        T predicted[2];
        // ... 投影计算 ...
        residuals[0] = predicted[0] - T(observed_.x);
        residuals[1] = predicted[1] - T(observed_.y);
        return true;
    }

    cv::Point2d observed_;
    cv::Point3d world_;
};
```

## 实践建议

1. **噪声处理**：实际场景中 2D 点检测存在噪声，建议使用 RANSAC 外点剔除
2. **初始值**：EPnP 给出的结果作为 BA 的初始值，加速收敛
3. **多帧约束**：利用帧间连续性，将多帧观测联合优化可以显著提高精度

## 总结

PnP + BA 的组合方案在 RoboMaster 实战中表现优异。单独 EPnP 的精度约 ±3°，加入 BA 优化后可提升至 ±1.5° 以内，这对远距离射击至关重要。
