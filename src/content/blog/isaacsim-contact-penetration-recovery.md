---
title: "Isaac Sim 穿模与弹开复盘：AuraVLA 的接触参数修复"
date: "2026-08-20"
description: "结合网络 Collision 文章与 AuraVLA 修改日志，复盘穿模、弹开和抓取滑落，并给出当前代码中的 PhysX 修复配置。"
tags: ["Isaac Sim", "PhysX", "机器人抓取", "仿真调试", "工程实践", "双指夹爪"]
category: "tech"
references:
  - title: "Isaac Sim Collision 进阶"
    meta: "Axi's Blog · Isaac 101"
    url: "https://axi404.top/blog/isaac-6"
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 前言

参考 [Isaac Sim 一百讲（6）：Collision 进阶](https://axi404.top/blog/isaac-6)，穿模应从碰撞几何、接触生成和求解迭代一起排查，而不是只改抓取姿态。该文给出的通用示例是 `contact_offset=0.02`、position iterations `32`；AuraVLA 的修改日志进一步说明，夹爪控制速度、桌面净空和 PhysX 解除穿透速度同样会改变结果。

## 现象描述

历史抓取记录中，夹爪闭合后物体只抬升约 `8 mm`，水平漂移约 `82 mm`，同时出现 `grasp_acquired=false`。另一类失败是指尖进入桌面或物体后被 PhysX 瞬间推出。它们不能只通过增加抓取深度解决，过深会把几何误差转成更大的纠偏冲量。

## 解决方案

AuraVLA 当前代码采用 TGS、60 Hz、稳定化开启，并固定以下参数：

| 参数 | 当前值 | 目的 |
| --- | ---: | --- |
| `physx_contact_offset_m` | `0.003 m` | 避免过早生成幽灵接触 |
| `physx_rest_offset_m` | `0.001 m` | 保留静止几何间隙 |
| position / velocity iterations | `32 / 8` | 提高接触收敛 |
| `physx_max_depenetration_velocity` | `0.2 m/s` | 限制纠偏冲击 |
| CCD | `false` | 避免铰接夹爪分离 |
| convex hull | `64` 顶点、`16` hull | 控制碰撞近似误差 |

## 参考方案的项目落地

AuraVLA 已采用该文章中的四项关键思路：

1. Visual Mesh 与 Collision Mesh 分离，碰撞网格使用 `convexDecomposition`；
2. 凸分解限制为 `64` 个 hull 顶点、最多 `16` 个 hull，并启用 shrink-wrap，误差上限为 `0.1`；
3. position solver iterations 固定为 `32`，配合 velocity iterations `8`；
4. 通过 Physics Material 设置静/动摩擦，恢复系数固定为 `0`。

CCD 没有照搬为默认开关。参考文章已经指出全局 CCD 与铰接夹爪的局部 CCD 叠加可能导致夹爪分离，AuraVLA 因此保持全局和刚体 CCD 关闭。

唯一没有直接照搬的是 `contact_offset`：网络文章的 `0.02 m` 适合其通用资产实验，而 AuraVLA 使用 `0.003 m`，因为 20 mm 会让 DACH 夹爪尚未视觉接触就触发约束。参数必须结合资产尺度和接触日志调整。

## 夹爪与运动

碰撞参数只能解决接触层问题。AuraVLA 同时将物体设置为动态刚体，质量为 `0.05 kg`，线性和角阻尼为 `12.0`，材质恢复系数为 `0`；夹爪接触材质按配置使用静摩擦 `10`、动摩擦 `8`。运行时默认值与 YAML 配置可能不同，部署时必须记录最终生效环境变量。

抓取流程先检查 GraspNet 点、夹爪几何中心和桌面净空，再进行闭合；预紧确认默认 `3` 帧，接触稳定后才进入抬升。搬运路径采用笛卡尔采样，避免关节插值绕着物体横扫；抬升成功还要重新读取物体位姿，而不是只看夹爪命令返回值。

## 验证

固定场景、物体姿态和物理频率，至少比较：原配置、仅降速、加入 `0.2 m/s` 解除速度限制、完整接触配置。记录首次接触帧、最大纠偏速度、垂直抬升、水平漂移和 `grasp_acquired`。没有固定 Seed 与样本数时，不把单次观察写成成功率结论。

## 总结

穿模与弹开不是单个 PhysX 开关的问题。AuraVLA 的修复顺序是：先校正碰撞几何和桌面净空，再限制运动步长与解除穿透速度，最后调摩擦和预紧。CCD 保持关闭，除非针对具体高速薄物体场景完成独立 A/B 验证。
