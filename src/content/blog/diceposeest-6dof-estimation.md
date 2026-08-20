---
title: "DicePoseEst：骰子检测与 6-DoF 姿态估计系统"
date: "2025-05-24"
description: "融合 YOLO、PnP、Ceres BA 与 PoseNet 的骰子检测及六自由度姿态估计系统，支持图像、视频与实时屏幕捕获。"
tags: ["计算机视觉", "PnP", "PyTorch", "Python", "姿态估计"]
category: "tech"
references:
  - title: "OpenCV solvePnP Documentation"
    meta: "OpenCV · Camera Calibration and 3D Reconstruction"
    url: "https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html"
  - title: "Ceres Solver"
    meta: "Non-linear least squares optimization"
    url: "https://ceres-solver.org/"
---

## 项目概述

DicePoseEst 是一套面向彩色骰子的检测与六自由度姿态估计系统。项目将深度学习检测、经典多视图几何与非线性优化组织在同一条可观测、可调试的处理链路中，从图像里的目标区域出发，最终输出相机坐标系下的旋转向量与平移向量。

系统通过 PyQt5 桌面端统一接入图片、视频和 Windows 屏幕捕获，能够独立显示 YOLO、PnP、BA、PoseNet 与融合结果，同时提供置信度、轮廓面积、Huber Loss 等运行参数的交互式调节。

**技术栈：** Python · YOLOv10 · OpenCV · Ceres · PyTorch · PyQt5

**项目地址：** [DicePoseEst GitHub 仓库](https://github.com/AcmeX-Cosmos/DicePoseEst)

## 处理流水线

```
[图像 / 视频 / 屏幕捕获]
            │
            ▼
      YOLO 目标检测
            │
            ▼
  颜色分割与骰面角点提取
       ┌────┼────────┐
       ▼    ▼        ▼
      PnP  Ceres BA  PoseNet
       └────┼────────┘
            ▼
  重投影误差评估与结果融合
            │
            ▼
    3D 坐标轴与位姿可视化
```

YOLO 首先给出骰子的目标框与类别置信度，系统在 ROI 内依据骰面颜色完成分割，通过轮廓层级与面积约束排除噪声，再从有效轮廓中提取用于几何解算的二维角点。

## 核心方法

### PnP 初始位姿

项目使用相机标定参数、骰子三维模型点与图像二维角点建立 3D-2D 对应关系，通过 OpenCV `solvePnP` 求得旋转向量和位移向量。随后将三维模型重新投影到图像平面，以平均像素距离衡量估计质量。

### Ceres 束调整

PnP 输出作为非线性优化初值。BA 模块以角点重投影误差为残差，使用 Levenberg-Marquardt 信赖域策略和 `DENSE_QR` 线性求解器联合精化旋转与平移，并通过 Huber Loss 降低异常角点对结果的影响。

### PoseNet 回归与融合

PoseNet 从归一化后的骰面图像直接回归 Rodrigues 旋转向量，构成独立于几何求解的学习分支。系统对 PnP、BA 和 PoseNet 的候选结果使用统一的重投影误差进行比较，并输出当前观测下的最佳位姿。

## 工程模块

| 模块 | 实现 | 职责 |
|------|------|------|
| 目标检测 | Ultralytics YOLO | 目标定位、类别识别与 ROI 裁剪 |
| 表面识别 | OpenCV | 颜色分割、轮廓筛选与角点提取 |
| 几何解算 | OpenCV PnP | 生成六自由度初始位姿 |
| 非线性优化 | Ceres BA | 基于重投影误差精化旋转和平移 |
| 旋转回归 | PyTorch PoseNet | 从骰面图像直接预测旋转向量 |
| 桌面应用 | PyQt5 | 多源输入、参数调节与结果可视化 |

## 量化结果

| 指标 | 结果 |
|------|------|
| PoseNet 训练 MAE | 0.034 rad |
| 目标检测 mAP | 95%+ |
| 输入类型 | 图像、视频、实时屏幕捕获 |

## 数据闭环

系统能够根据重投影误差筛选高质量几何结果，将骰面图像、角点与旋转向量写入训练数据。这使 PnP 与 BA 不仅承担在线姿态估计，也能为 PoseNet 持续生成带几何约束的监督样本，形成经典方法辅助学习方法的数据闭环。
