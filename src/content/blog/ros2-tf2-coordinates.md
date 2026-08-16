---
title: "TF2 坐标变换：ROS2 中的多坐标系管理最佳实践"
date: "2025-08-27"
description: "深入理解 ROS2 TF2 系统的工作原理、坐标系命名规范和常见踩坑指南，是机器人视觉系统的基础设施。"
tags: ["ROS2", "TF2", "坐标系", "C++"]
category: "tech"
---

## TF2 是什么

TF2 是 ROS2 中管理多坐标系变换的核心库。在机器人系统中，至少会涉及以下坐标系：

- `map` — 世界固定坐标系
- `odom` — 里程计坐标系
- `base_link` — 机器人底盘坐标系
- `camera_link` — 相机坐标系
- `gimbal_link` — 云台坐标系
- `barrel_link` — 枪管坐标系

这些坐标系之间存在树形变换关系，TF2 负责维护和查询这些变换。

## TF 树设计

合理的 TF 树设计是视觉系统的基础：

```
map
  └── odom
        └── base_link
              ├── gimbal_link
              │     └── camera_link
              └── barrel_link
```

## 基础用法

### 广播变换

```cpp
#include <tf2_ros/transform_broadcaster.h>

class TFBroadcaster : public rclcpp::Node
{
public:
    TFBroadcaster() : Node("tf_broadcaster")
    {
        tf_broadcaster_ = std::make_unique<tf2_ros::TransformBroadcaster>(*this);

        timer_ = create_wall_timer(
            std::chrono::milliseconds(10),
            std::bind(&TFBroadcaster::broadcast_transform, this)
        );
    }

private:
    void broadcast_transform()
    {
        geometry_msgs::msg::TransformStamped t;
        t.header.stamp = this->now();
        t.header.frame_id = "base_link";
        t.child_frame_id = "camera_link";

        // 相机相对于底盘的固定安装位姿
        t.transform.translation.x = 0.15;  // 相机在底盘前方 15cm
        t.transform.translation.z = 0.35;  // 相机高度 35cm

        // 云台 pitch 角
        tf2::Quaternion q;
        q.setRPY(0, pitch_angle_, 0);  // 仅 pitch 旋转
        t.transform.rotation = tf2::toMsg(q);

        tf_broadcaster_->sendTransform(t);
    }

    std::unique_ptr<tf2_ros::TransformBroadcaster> tf_broadcaster_;
    rclcpp::TimerBase::SharedPtr timer_;
    double pitch_angle_ = 0.0;
};
```

### 查询变换

```cpp
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>

class CoordinateLookup : public rclcpp::Node
{
public:
    CoordinateLookup() : Node("coord_lookup")
    {
        tf_buffer_ = std::make_unique<tf2_ros::Buffer>(this->get_clock());
        tf_listener_ = std::make_unique<tf2_ros::TransformListener>(*tf_buffer_);
    }

    // 将相机坐标系下的目标点转换到地图坐标系
    geometry_msgs::msg::PointStamped camera_to_map(
        const geometry_msgs::msg::PointStamped& camera_point)
    {
        return tf_buffer_->transform(camera_point, "map");
    }

private:
    std::unique_ptr<tf2_ros::Buffer> tf_buffer_;
    std::unique_ptr<tf2_ros::TransformListener> tf_listener_;
};
```

## 常见坑与解决方案

### 1. 时间戳对齐

```cpp
// ❌ 错误：使用 this->now() 查询过去时刻的变换
tf_buffer_->lookupTransform("map", "base_link", this->now());

// ✅ 正确：使用 tf2::TimePointZero 获取最新可用的变换
tf_buffer_->lookupTransform("map", "base_link", tf2::TimePointZero);

// ✅ 正确：查询特定时刻的变换，设置超时
tf_buffer_->lookupTransform("map", "base_link", stamp, tf2::durationFromSec(0.1));
```

### 2. TF 命名空间

```cpp
// 如果节点在命名空间 /robot1/vision 中运行
// TF 坐标系的完整名称需要包含命名空间前缀
// 或在构造 Buffer 时使用全局命名
```

### 3. 避免 TF 循环

```
# ❌ 错误：A 广播到 B，B 也广播到 A — 形成循环
# TF2 会报 "Lookup would require extrapolation" 错误
```

## 总结

TF2 是机器人感知系统的"骨骼"。理解 TF 树设计、掌握 TF2 API 的正确用法、防范常见的时间戳陷阱，是搭建稳定视觉系统的基础。在 RoboMaster 中，从相机到枪管的坐标系链条如果任何一环出错，瞄准精度就会大幅下降。
