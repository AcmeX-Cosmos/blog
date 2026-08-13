---
title: "[Integration] 华睿工业相机 ROS2 驱动：回调采图与断线自愈"
date: "2024-04-13"
description: "用 IMV SDK 的抓帧回调驱动 image_transport 发布，处理 Bayer 去马赛克、行填充对齐，以及相机掉线后的定时重连。"
tags: ["ROS2", "相机驱动", "image_transport", "C++"]
category: "tech"
---

## [Integration] 相机 SDK ↔ ROS2 image_transport - 2024-04-13

比赛用的是华睿（Huaray）工业相机，厂商给的是 IMV SDK，接口风格是典型的 C 风格句柄 + 回调。要把它接进 ROS2，本质上是把 SDK 的推送模型翻译成 ROS2 的发布模型。

### 1. 接口定义

- **Topic 名称**：`image_raw`（由 `image_transport::create_camera_publisher` 同时发布 image 与 camera_info）
- **消息格式**：`sensor_msgs/Image` + `sensor_msgs/CameraInfo`
- **QoS**：`rmw_qos_profile_sensor_data`——BestEffort + KeepLast(5)
- **分辨率**：1280 × 1024，`bgr8`
- **frame_id**：`camera_optical_frame`

QoS 用 sensor_data 而不是默认的 reliable，是因为图像流丢一帧远比阻塞发布线程要好。Reliable QoS 在订阅端卡顿时会反压到发布端，对实时视觉是灾难。

### 2. 数据流

SDK 侧走注册回调，不是主动 poll：

```cpp
IMV_SetBufferCount(dev_handle_, 10);
IMV_AttachGrabbing(dev_handle_, &CameraNode::sdk_frame_callback, this);

uint64_t maxImagesGrabbed = 0;                        // 0 = 不限帧数
IMV_EGrabStrategy strategy = grabStrartegyLatestImage; // 只保留最新帧
IMV_StartGrabbingEx(dev_handle_, maxImagesGrabbed, strategy);
```

`grabStrartegyLatestImage` 是这里最关键的一个选择。默认策略会把帧排进缓冲队列按序取出，一旦下游处理跟不上，取到的就是几十毫秒前的旧图——对自瞄来说旧图等于错误的目标位置。改成 latest 之后宁可丢帧也不给过期数据。

回调里做格式转换：

```cpp
stPixelConvertParam.eBayerDemosaic  = demosaicBilinear;  // 双线性去马赛克
stPixelConvertParam.eDstPixelFormat = gvspPixelBGR8;
stPixelConvertParam.nPaddingX       = frame->frameInfo.paddingX;
stPixelConvertParam.nPaddingY       = frame->frameInfo.paddingY;

IMV_PixelConvert(dev_handle_, &stPixelConvertParam);
```

### 3. 三个必须处理的细节

**行填充（padding）不能忽略。** 缓冲区尺寸算的是

```cpp
size_t bufferSize = (frame->frameInfo.width + frame->frameInfo.paddingX)
                    * frame->frameInfo.height * 3;
```

不是 `width * height * 3`。相机为了 DMA 对齐会在每行末尾补字节，按裸宽度分配缓冲会踩内存。第一次遇到时的表现是图像下半部分花屏——因为每行都少读了 padding 个字节，误差逐行累积。

**转换缓冲用 `static` 复用。** 回调频率等于帧率，每帧 new 一个 3.9 MB 的 vector 会让内存分配器成为瓶颈。声明成 `static std::vector<unsigned char> convertBuffer;` 后只在尺寸变化时才 resize。

**时间戳在回调里打，不在发布前打。** 

```cpp
image_msg_.header.stamp = camera_info_.header.stamp = this->now();
```

放在格式转换之后、publish 之前，中间隔了一次去马赛克。严格来说这个戳晚于真实曝光时刻，误差是转换耗时。下游 EKF 用它算 `dt`，系统性偏移会被当成常量延迟吸收进 `prediction_delay` 参数里，所以暂时可以接受，但如果要做更严的时间同步，应该用 SDK 帧信息里的硬件时间戳。

### 4. 断线自愈

赛场上相机 USB 接口被撞松是真实存在的故障模式。构造函数里初始化失败不直接退出，而是挂一个定时器：

```cpp
if (!init_camera()) {
    reconnect_timer_ = this->create_wall_timer(
        std::chrono::seconds(2),
        std::bind(&CameraNode::try_reconnect, this));
}

void CameraNode::try_reconnect() {
    if (init_camera()) {
        reconnect_timer_->cancel();   // 成功后停表
    }
}
```

`init_camera()` 开头先调 `cleanup_camera()`，保证重连前把旧句柄彻底释放（`IMV_StopGrabbing` → `IMV_Close` → `IMV_DestroyHandle` 三步缺一不可）。漏掉 `IMV_DestroyHandle` 的话重连几次之后 SDK 就再也枚举不到设备了，必须重启进程。

这个自愈只覆盖了"启动时相机不在"的情况。运行中掉线目前不会触发重连——回调只是停止调用，节点看起来还活着。这个缺口由上层的[心跳看门狗](/blog/guard-dog-heartbeat-tmux)兜底：检测节点长时间收不到图就不发心跳，看门狗重启整条链路。

### 5. 联调结果

节点以组件形式注册，可以和检测节点跑在同一个进程里省掉一次序列化：

```cpp
#include "rclcpp_components/register_node_macro.hpp"
RCLCPP_COMPONENTS_REGISTER_NODE(rcia::camera_driver::CameraNode)
```

`ros2 topic hz /image_raw` 稳定在相机标称帧率，`ros2 topic bw` 与 `1280×1024×3×fps` 吻合，说明没有多余拷贝。

---

下一篇是另一半 I/O：[串口协议与原子双缓冲](/blog/serial-protocol-double-buffer)。
