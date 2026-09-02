---
title: "组件容器与进程内零拷贝：两个 container 的分工"
date: "2024-09-03"
description: "RCIA-vision 为什么把节点拆进两个 ComposableNodeContainer，多线程容器与单线程容器各放什么，以及 intra-process 零拷贝生效的前提条件。"
tags: ["ROS2", "Component", "架构", "launch"]
category: "tech"
references:
  - title: "rmoss_core"
    meta: "RoboMaster OpenSource Software"
    url: "https://github.com/robomaster-oss/rmoss_core"
---

## camera_container ↔ ComponentManager

1280 × 1024 的 BGR8 图像单帧 3.9 MB。如果相机节点和检测节点是两个进程，每帧要走一次序列化、一次 DDS 传输、一次反序列化——在自瞄这种帧率敏感的场景里这笔开销不能接受。

ROS2 的解法是 composable component：把节点编译成共享库，多个节点加载进同一个进程，通过 `use_intra_process_comms` 让消息以 `shared_ptr` 直接传递。

### 1. 接口定义

节点全部注册为组件：

```cpp
#include "rclcpp_components/register_node_macro.hpp"
RCLCPP_COMPONENTS_REGISTER_NODE(rcia::camera_driver::CameraNode)
```

launch 里声明成 `ComposableNode`：

```python
image_node = ComposableNode(
    package='rcia_camera_driver',
    plugin='rcia::camera_driver::CameraNode',
    name='camera_node',
    parameters=[camera_params],
    extra_arguments=[{'use_intra_process_comms': True}]
)
```

### 2. 为什么是两个容器

`bringup.launch.py` 起了两个容器，可执行文件不一样：

```python
# 容器一：图像链路，多线程
return ComposableNodeContainer(
    name='camera_container',
    namespace='camera',
    package='rclcpp_components',
    executable='component_container_mt',      # ← 多线程
    composable_node_descriptions=[image_node, vision_detector_node],
)

# 容器二：解算链路，单线程
container = ComposableNodeContainer(
    name='ComponentManager',
    namespace='',
    package='rclcpp_components',
    executable='component_container',         # ← 单线程
)
```

解算链路（serial_driver、math_solver、vision_tracker）在容器起来之后再挂载：

```python
load_action = TimerAction(
    period=1.0,
    actions=[LoadComposableNodes(
        target_container='/ComponentManager',
        composable_node_descriptions=[serial_driver_composable,
                                      math_solver_composable,
                                      vision_tracker_composable]
    )]
)
```

分成两个容器的理由是**执行模型不同**。

相机侧是回调驱动的：SDK 抓帧回调、图像订阅回调，两者天然并发，用 `component_container_mt`（MultiThreadedExecutor）让它们各跑各的。相机回调阻塞时不会拖住检测。

解算侧是严格串行的流水线：`armor_bapose_info` → BA → EKF → 云台指令，每一步依赖上一步的输出。上这条链用多线程没有任何收益，反而要给共享状态加锁。更要命的是 [BA 求解器里那个全局变量](/pnp-ba-yaw-refine)——它本来就不是线程安全的，单线程容器等于免费给它上了一把锁。

### 3. 零拷贝的前提

`use_intra_process_comms: True` 不是打开就一定生效，有几个硬条件：

**必须在同一个进程里。** 跨容器的话这个标志完全无效，消息照样走 DDS。camera 和 detector 在同一容器就是为这个。

**QoS 必须兼容且 durability 为 volatile。** transient_local 的话 intra-process 直接回退。

**发布时用 `unique_ptr` 才是真零拷贝。** 用 `const&` 发布的话消息会被拷贝一次再进队列。相机节点目前发的是成员变量 `image_msg_`，严格说这里还有一次拷贝空间可以省——把 `image_msg_` 改成每帧新建的 `unique_ptr` 交出所有权，但那样又要重新分配 3.9 MB 缓冲，得先测过再改。

### 4. 时序约束

两个容器都套了 `TimerAction(period=1.0)`：

```python
delayed_camera_container = TimerAction(period=1.0, actions=[get_camera_container()])
```

延迟启动不是玄学。`robot_state_publisher` 要先把 URDF 解析完、把静态 TF 发出去，`vision_tracker` 的 `tf2_filter` 才能查到 `gimbal_link` → `odom` 的变换。启动顺序错了的表现是跟踪节点刷一屏 `lookupTransform` 异常，然后自己恢复——能用但难看，而且前几十帧的目标被白白丢掉。

`robot_state_publisher` 的 `publish_frequency` 设成 1000.0，比常见的 50 Hz 高一个量级。云台是高速运动的，TF 发布频率低于图像帧率的话，`tf2_filter` 只能拿到插值结果，姿态滞后会直接进入位姿解算。

### 5. 联调结果

验证零拷贝是否真的生效，最直接的办法是看进程数和 CPU：

```bash
ros2 component list                 # 确认节点都挂在容器下
ps -eLf | grep component_container  # 两个进程，不是六个
```

再用 `ros2 topic hz /image_raw` 对照 `top` 里的 CPU 占用。跨进程时 DDS 线程会有明显的常驻开销，改成组件后这部分基本消失。

---

下一篇是解算链的入口：[TF2 消息过滤器与 odom 对齐](/tf2-message-filter-odom)。
