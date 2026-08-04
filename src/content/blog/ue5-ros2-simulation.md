---
title: "UE5 与 ROS2 的虚实融合仿真：以 RoboMaster 为例"
date: "2025-04-02"
description: "介绍如何利用 Unreal Engine 5 搭建高保真竞技场仿真环境，并与 ROS2 实现双向闭环，用于视觉算法的开发与验证。"
tags: ["UE5", "ROS2", "仿真", "虚拟现实"]
---

## 为什么需要虚实融合

在 RoboMaster 视觉算法开发中，面临两个痛点：
1. **真机调试成本高**：需要场地、机器人、裁判系统全部就位
2. **纯仿真不够真实**：传统 Gazebo 仿真难以还原真实的相机成像和竞技环境

UE5 的高保真渲染 + ROS2 的通信能力，可以构建一个逼近"实拍"效果的仿真环境。

## 系统架构

```
┌─────────────────────────────┐
│         Unreal Engine 5     │
│  ┌───────────────────────┐  │
│  │   竞技场场景 (3D渲染)    │  │
│  │   虚拟相机 (Lumen光照)  │  │
│  │   机器人物理模拟         │  │
│  └───────────┬───────────┘  │
│              │               │
└──────────────┼───────────────┘
               │ UDP / TCP
┌──────────────┼───────────────┐
│         ROS2 Bridge           │
│  ┌───────────┴───────────┐   │
│  │  图像 Topic            │   │
│  │  云台控制 Service       │   │
│  │  裁判数据 Topic         │   │
│  └───────────────────────┘   │
└──────────────┼───────────────┘
               │
┌──────────────┼───────────────┐
│         视觉算法 (ROS2)       │
│  装甲板检测 → 位姿估计 → 控制 │
└──────────────────────────────┘
```

## UE5 端的实现要点

### 虚拟相机

使用 UE5 的 SceneCaptureComponent2D，设置与真实相机一致的参数：

```cpp
// 虚拟相机配置
SceneCapture->FOVAngle = 90.0f;  // 与真实相机 FOV 一致
SceneCapture->TextureTarget->InitAutoFormat(1440, 1080);  // 分辨率

// 模拟真实相机曝光
PostProcessSettings.bOverride_AutoExposureBias = true;
PostProcessSettings.AutoExposureBias = -5.0f;
```

### ROS2 通信层

通过 UDP socket 将渲染图像和 ROS2 节点桥接：

```python
# Python bridge 示例
import rclpy
from sensor_msgs.msg import Image
import socket
import numpy as np

class UE5Bridge:
    def __init__(self):
        self.image_pub = self.create_publisher(Image, '/ue5/camera/image', 10)
        self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp_socket.bind(('0.0.0.0', 10000))

    def run(self):
        while rclpy.ok():
            data, _ = self.udp_socket.recvfrom(65536)
            # 解码图像并发布到 ROS2
            img_msg = self.decode_image(data)
            self.image_pub.publish(img_msg)
```

## 双向闭环

不仅 UE5 → ROS2 发送图像，算法解算出的控制指令也回传 UE5，驱动虚拟云台：

```
检测图像 → PnP解算 → 角度计算 → 云台控制 → 虚拟云台转动
    ↑                                                    ↓
    ←──────────── 虚拟相机实时渲染 ←───────────────────
```

这个闭环让我们在 UE5 中就可以完整验证算法的跟踪和射击精度。

## 效果

- 视觉算法在仿真环境中验证通过后，移植到真机几乎零改动
- 开发效率提升 3 倍以上
- 可模拟各种极端工况（暗光、逆光、快速机动等）

这部分的探索也形成了我毕业设计《基于虚实融合的机器人跟踪射击系统》的核心内容。
