---
title: "串口协议与原子双缓冲：视觉与电控的数据交换"
date: "2024-08-18"
description: "InfantryProtocol 的收发打包、UART 传输层抽象，以及用原子指针双缓冲让高频串口数据与图像回调无锁共享。"
tags: ["ROS2", "串口", "并发", "C++"]
category: "tech"
---

## serial_driver ↔ vision_detector

视觉和电控之间只有一根串口线。上行发云台角度和开火指令，下行收当前姿态、弹速、我方颜色。看起来简单，但这条链路是整个系统里唯一的硬实时边界——图像慢一帧只是延迟，串口错一个字节可能让云台甩飞。

### 1. 接口定义

- **设备**：`/dev/ttyACM0`，波特率 115200，8N1，无流控
- **上行 Topic**：`vision_data`（`SerialTransmitData`）
- **下行 Topic**：`electrl_data`（`SerialReceiveData`）

消息定义：

```
# SerialReceiveData.msg          # SerialTransmitData.msg
std_msgs/Header header           std_msgs/Header header
int32   pitch_angle              int32   pitch_angle
int32   yaw_angle                int32   yaw_angle
uint8   bullet_speed             uint8   find_flag
string  our_color                uint8   fire_flag
uint8   vision_mode              uint32  time_stamp
uint32  time_stamp               uint8   operator_ui_x
                                 uint8   operator_ui_y
                                 float32 distance
```

角度用 `int32` 而不是 `float`，是电控那边定的——定点数传输避免了浮点格式在 MCU 和 x86 之间的对齐问题，代价是双方要约定同一个缩放因子。

### 2. 分层：Protocol / Transporter

驱动拆成两层，中间用纯虚基类隔开：

```cpp
class InfantryProtocol : public Protocol {
public:
    explicit InfantryProtocol(rcia::serial_driver::UartTransporter& uart);

    struct SerialReceiveData receive() override;
    void transmit(struct SerialTransmitData* serial_send_data_ptr) override;

private:
    void pack_data(uint8_t* buffer, const struct SerialTransmitData* ptr);
    void pack_header(uint8_t* buffer);
    struct SerialReceiveData parse_data(const uint8_t* data);
};
```

`UartTransporter` 只管字节进出（open / read / write / 重连），`Protocol` 只管帧格式（帧头、字段布局、校验）。分开的实际收益是：兵种协议不一样时只换 Protocol 子类，传输层一行不动；调试时也可以把 Transporter 换成文件回放。

`simulate_mode: true` 是仿真开关。开着的时候不真的开串口，直接喂预设数据——这让整条视觉链路可以在没有机器人的情况下跑起来，[UE5 虚实闭环](/blog/ros2-ue5-bridge-coordinate)也依赖这个开关。

### 3. 原子双缓冲

串口下行数据和图像回调不在一个线程。检测节点每处理一帧都要读最新的云台姿态，如果加锁，图像线程会被串口线程的写入阻塞。

用的是原子指针双缓冲：

```cpp
// armor_identify.hpp
std::atomic<rcia::Xin_Main::SerialDataStruct *> current_read_buffer_;
rcia::Xin_Main::SerialDataStruct buffer1_, buffer2_;   // 双缓冲实例
```

写线程往非活跃的那块写，写完把 `current_read_buffer_` 原子地指过去；读线程只 load 指针再解引用。读侧完全无锁，写侧只有一次原子 store。

这个模式成立的前提是**单写者**。串口只有一个接收线程在写，所以不需要处理两个写者同时抢缓冲的问题。如果哪天加了第二个数据源，这套就不安全了，得换成真正的双缓冲队列或 seqlock。

### 4. 时序约束

- 串口下行帧率取决于电控，实测在 200 Hz 量级
- 图像 30–60 FPS，每帧读一次姿态
- 上行只在跟踪状态下发，`fire_flag` 由[开火判据](/blog/gimbal-armor-selection-fire)决定

读频率远低于写频率，意味着大部分串口帧其实被丢弃了——这是刻意的。检测只需要\"当前最新姿态\"，历史帧没有价值，双缓冲天然实现了这个语义。

### 5. 联调结果

节点同样注册为 composable component，和 math_solver、vision_tracker 一起加载进 `ComponentManager` 容器：

```python
serial_driver_composable = ComposableNode(
    package='rcia_serial_driver',
    plugin='rcia::serial_driver::SerialDriverNode',
    name='serial_driver_node',
    parameters=[get_params("serial_driver")],
    extra_arguments=[{'use_intra_process_comms': True}]
)
```

验证方式是拿逻辑分析仪抓 TX/RX，对照 `ros2 topic echo` 的内容逐字节比对。这一步不能省——曾经有一次帧头对了、字段偏移错了一个字节，ROS2 侧看起来\"有数据\"，实际 yaw 和 pitch 是错位的。

---

下一篇进入视觉本身：[颜色通道相减与伽玛校正](/blog/armor-color-split-gamma)。
