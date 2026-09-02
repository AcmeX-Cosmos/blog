---
title: "TF2 消息过滤器：把装甲板位姿搬进 odom 系"
date: "2024-09-05"
description: "用 tf2_ros::MessageFilter 让位姿消息等到变换可用再触发回调，以及云台高频 TF 发布为什么必须是 1000 Hz。"
tags: ["ROS2", "TF2", "坐标系", "C++"]
category: "tech"
---

## armor_bapose_info ↔ odom

BA 解出来的位姿在**相机系**里。但跟踪要在一个不随云台转动的系里做——云台一转，相机系里的静止目标看起来在飞，EKF 的匀速模型立刻失效。所以位姿必须先变换到 `odom`。

麻烦在于时间。图像帧的时间戳是 $t$，要用的也是 $t$ 时刻的云台姿态，而 TF 的发布和图像回调不同步。直接 `lookupTransform(..., tf2::TimePointZero)` 拿到的是"最新可用"的变换，云台高速转动时这个"最新"可能已经差了十几毫秒。

### 1. 接口定义

- **输入 Topic**：`armor_bapose_info`（`ArmorBaposeInfo`），QoS = sensor_data + BestEffort
- **目标坐标系**：`odom`（由参数 `gimbal_link` 指定，默认值就是 `"odom"`）
- **输出**：`OdomMeasurement`，位姿已在 odom 系下
- **TF 链**：`odom` → `gimbal_link` → `camera_optical_frame`

### 2. MessageFilter 而不是手写 lookup

```cpp
armor_bapose_sub_.subscribe(this, "armor_bapose_info", qos_profile);
target_frame_ = this->declare_parameter("gimbal_link", "odom");

tf2_filter_ = std::make_shared<tf2_filter>(
    armor_bapose_sub_, *tf2_buffer_, target_frame_, 10,
    this->get_node_logging_interface(),
    this->get_node_clock_interface(),
    std::chrono::duration<int>(1));

tf2_filter_->registerCallback(&VisionTrackerNode::solver_callback, this);
```

`tf2_ros::MessageFilter` 做的事情是：消息到达时先检查 `header.stamp` 对应的变换在不在 buffer 里，不在就**缓存起来等**，等到了再触发回调，超时（这里 1 秒）就丢弃。

这比手写 `lookupTransform` 好在两点。一是它用消息自己的时间戳查变换，拿到的是时间对齐的姿态而不是"最新"姿态；二是启动阶段 TF 还没发出来的那几十帧不会刷异常，而是安静地排队。

队列深度 10。设大了的话，TF 长时间不可用时会攒一堆过期消息，等 TF 恢复后一次性涌进 EKF——那些几百毫秒前的观测对跟踪只有害处。

参数名叫 `gimbal_link` 但默认值是 `"odom"`，这是历史遗留的命名错位，读代码时容易误解成"变换到云台系"。实际语义是目标坐标系。

### 3. TF 发布频率

```python
robot_gimbal_publisher = Node(
    package='robot_state_publisher',
    executable='robot_state_publisher',
    parameters=[{'robot_description': robot_gimbal_description,
                'publish_frequency': 1000.0}]
)
```

1000 Hz 不是随手写的。MessageFilter 查询任意时刻的变换时，TF2 会在最近的两个采样点之间做**线性插值**。云台yaw速度可以到 6 rad/s，50 Hz 发布意味着相邻样本间隔 20 ms，期间云台转过 6.9°，线性插值的误差直接进入位姿。1000 Hz 把这个间隔压到 1 ms，插值误差降到 0.35°，落在可接受范围内。

代价是 TF 话题的带宽和 CPU。实测下来这部分开销远小于它省掉的精度损失。

### 4. URDF 参数化

云台相对底盘的安装位置从 yaml 注入 xacro：

```python
gimbal_params = yaml.safe_load(open(.../'gimbal_params.yaml'))

robot_gimbal_description = Command([
    'xacro ', PathJoinSubstitution([...,'rcia_gimbal.urdf.xacro']),
    ' xyz:="', gimbal_params['gimbal']['xyz'],
    '" rpy:="', gimbal_params['gimbal']['rpy'], '"'
])
```

```yaml
gimbal:
    xyz: "0.15 0 -0.05"
    rpy: "0 0 0"
```

相机在云台轴前方 0.15 m、下方 0.05 m。这两个数标定错了的话，近距离目标的位姿会有系统性偏移——而且是随云台pitch变化的偏移，看起来像非线性误差，很难归因。

改安装位置只动 yaml、不动 URDF，是因为赛季中途换车、换支架是常事。

### 5. 联调结果

排查这条链路的顺序：

```bash
ros2 run tf2_tools view_frames          # 确认 TF 树完整无断裂
ros2 run tf2_ros tf2_echo odom camera_optical_frame
ros2 topic hz /tf                        # 应该在 1000 Hz 附近
```

TF 树断裂最典型的症状是 MessageFilter 完全不触发回调，而节点毫无报错——因为它的设计就是安静地等。调试时如果发现"消息在发但回调不进"，第一件事就是查 TF。

---

下一篇回到检测末端：[LeNet-5 ONNX 数字分类](/armor-digit-lenet-onnx)。
