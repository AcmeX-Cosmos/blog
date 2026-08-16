---
title: "Foxglove 在线调参：把 ROS2 参数回调接进比赛现场"
date: "2025-09-09"
description: "用 foxglove_bridge 暴露参数与可视化话题，on_set_parameters 回调的校验时机，以及\"每帧 get_parameter\"这种写法的真实代价。"
tags: ["ROS2", "Foxglove", "调参", "可视化", "C++"]
category: "tech"
---

## 现场调参基础设施

RoboMaster 的检录到上场之间只有几分钟。场地灯光和训练室不一样，红蓝阈值大概率要改；对手换了车型，跟踪门限可能也要动。如果每改一个数都要停节点、改 yaml、重启、等相机重连，这几分钟什么都做不完。

所以 `ros2_foxglove_bridge` 是直接 vendor 进 `src/` 的，不是作为外部依赖装的——比赛机器不能假设有网络。

### 它解决的两件事

**参数在线可写。** bridge 通过 WebSocket 暴露 ROS2 的参数服务，Foxglove 面板里拖一个滑块就等于调了一次 `set_parameters`。

**话题可视化。** 跟踪节点发布的 `visualization_marker_array` 可以直接在 3D 面板里看：

```cpp
position_marker_.ns   = "position";
position_marker_.type = visualization_msgs::msg::Marker::SPHERE;
position_marker_.scale.x = position_marker_.scale.y = position_marker_.scale.z = 0.1;
position_marker_.color.a = 1.0;
position_marker_.color.g = 1.0;      // 绿球 = EKF 估计的整车中心

armors_marker_.ns   = "filtered_armors";
armors_marker_.type = visualization_msgs::msg::Marker::SPHERE_LIST;
armors_marker_.color.r = 1.0;        // 红球 = 反推出的四块装甲板
```

绿球和红球一起看，[9 维 EKF](/blog/ekf9-spintop-tracker) 到底估得对不对是一眼的事——四个红球应该均匀绕着绿球转，半径不跳、中心不飘。数字看不出来的问题，图上一秒就能看出来。

### 参数校验回调

检测节点注册了 `on_set_parameters`：

```cpp
rclcpp::node_interfaces::OnSetParametersCallbackHandle::SharedPtr set_paramters_callback_handle_;

rcl_interfaces::msg::SetParametersResult
ArmorIdentifier::on_set_parameters(const std::vector<rclcpp::Parameter> &parameters);
```

这个回调的语义是**预校验**：它在参数真正生效之前被调用，返回 `result.successful = false` 就能拒绝这次修改。所以它是最后一道防线——比如把 `max_contours` 拖到 5000，可以在这里直接驳回，而不是等[配对循环](/blog/light-bar-pairing-geometry)把节点卡死。

回调里不能做耗时操作，也不能在里面写状态：它可能因为一次批量设置被连续调用多次，而其中任何一个返回 false 都会让整批回滚。真正的应用逻辑应该放在参数已经生效之后读。

### 每帧 get_parameter 的代价

跟踪器和云台控制走的是另一条路——不注册回调，每帧重读：

```cpp
void SpinTopTracker::update(...) {
    try {
        auto node_ptr = node_.lock();
        tracking_thresh     = node_ptr->get_parameter("tracker.tracking_thresh").as_int();
        max_match_distance_ = node_ptr->get_parameter("tracker.max_match_distance").as_double();
        ekf_->r_x_          = node_ptr->get_parameter("ekf.r_x").as_double();
        // ... 共 9 次 get_parameter
    } catch (const std::runtime_error &e) {
        cout << "spinTop_tracker" << ": " << e.what() << endl;
    }
}
```

[云台控制](/blog/gimbal-armor-selection-fire)里还有一份类似的，11 次。

这么写的好处是极其省事——不用维护回调、不用管缓存失效，改了立刻生效。坏处有三个：

**开销。** `get_parameter` 要走节点的参数存储并做一次字符串查找，每帧 20 次落在跟踪回调的热路径上。单次很便宜，但它是纯粹白花的——参数一分钟也未必改一次。

**异常被吞。** `catch` 里只 `cout` 一行就继续跑。参数名打错时（这个项目里[真的发生过](/blog/ekf-qr-adaptive-tuning)），`get_parameter` 抛 `runtime_error`，被捕获后所有后续赋值全部跳过，那一帧用的是上一帧的旧值——看起来一切正常，没有任何告警。

**`weak_ptr::lock()` 失败没处理。** `node_.lock()` 返回空时直接解引用会段错误。节点正常运行期间不会发生，但析构过程中的最后几帧有理论风险。

正确的做法是注册 `on_set_parameters` 回调，在回调里更新成员变量，热路径只读成员。改动量不大，一直没做的原因是"能跑"——这是技术债最典型的形成方式。

### 现场调参的实际清单

按比赛流程排的优先级：

| 参数 | 什么时候调 |
| --- | --- |
| `enemy_color` | 每场必调，红蓝方交换 |
| `red_thresh` / `blue_thresh` | 换场地必看，[二值化](/blog/armor-color-split-gamma)受灯光影响最大 |
| `compensator.initial_velocity` | 换弹丸批次或枪管后，[弹道](/blog/ballistic-rk4-ceres)整条曲线跟着漂 |
| `gimbal_control.side_angle` | 对手车型偏灵活时收紧 |
| `tracker.max_match_distance` | 场地小、车密集时收紧防误跟 |

`debug_mode_enabled` 单独说一句：它控制 `debug.cpp` 里那套调试绘制。开着的时候每帧要画一堆文本和轮廓，帧率明显下降。训练时开，比赛时必须关——这个开关忘了关是很典型的翻车方式。

---

下一篇进虚实闭环：[ROS2-UE5 桥接的坐标系与延迟](/blog/ros2-ue5-bridge-coordinate)。
