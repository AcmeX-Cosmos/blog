---
title: "AuraVLA 夹爪几何验收：先确认能夹住，再允许机器人运动"
date: "2026-08-06"
description: "从 DACH 夹爪开口、物体最小宽度、GraspNet 候选和桌面净空四个约束，建立抓取前的物理可行性检查。"
tags: ["AuraVLA", "Isaac Sim", "机器人抓取", "GraspNet", "几何验证"]
category: "algorithm"
references:
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 为什么要做运动前验收

仅检查目标位姿是否能被 IK 求解，并不能证明夹爪能够闭合。DACH 夹爪的实际开口、物体沿闭合轴的投影宽度和指尖到桌面的净空都可能使一个“可达”目标变成物理上不可抓取的目标。

## 最小抓取宽度

AuraVLA 在运动前沿物体闭合轴计算最小包围宽度，并与实时夹爪内开口比较：

$$
w_{required}=w_{object}+m,qquad w_{required}\leq w_{jaw}
$$

香蕉使用 `4 mm` 安全余量，罐体使用 `0.5 mm`。若 `w_required > w_jaw`，任务在规划前返回失败，避免机器人先运动到目标附近才发现夹爪夹不住。

## GraspNet 与几何中心

GraspNet 是感知门槛，但不是物理验收。候选点要检查是否位于目标包围盒、Z 高度是否有效、是否满足夹爪闭合轴；罐体候选点还投影到经过验证的世界包围盒中心，防止点落在标签或瓶盖区域。

这一步保留了视觉模型的目标识别能力，同时把最后的抓取中心交给已标定的机械几何。模型不可用时返回 `GRASPNET_UNAVAILABLE`，不使用场景位姿作为静默回退。

## 桌面净空

指尖与桌面距离不能由 TCP 高度近似。AuraVLA 根据实时指尖碰撞几何预测最低点，并在目标下探前比较安全净空；预测不足时抬高抓取中心，后续闭环校正不能撤销这个保护量。

抓取接近阶段保持固定姿态和垂直方向，避免为了修正 XY 误差让倾斜夹爪横向扫过桌面。接触确认需要连续 `3` 帧，之后才允许进入抬升。

## 验证矩阵

固定相机、物体姿态和物理频率，分别记录：

- 夹爪开口与物体最小宽度；
- GraspNet 原始点到最终校正点的偏移；
- 预测桌面净空和实际最低净空；
- 接触确认帧数、闭合残差和物体闭合位移；
- 抬升后的物体高度与水平漂移。

失败响应应包含 `physical_constraint`、`grasp_strategy` 和 `error_code`，而不是只返回 `success=false`。

## 小结

抓取前验收把“能到达”拆成“夹爪能打开、候选点有效、桌面不碰撞、闭合后有接触”四个可测条件。任何一项不满足都应在运动前拒绝，减少 Isaac Sim 中无意义的碰撞尝试。
