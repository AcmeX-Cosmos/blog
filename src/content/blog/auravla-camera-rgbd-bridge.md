---
title: "AuraVLA RGB-D 相机桥：用序列元数据解决旧帧与半写入"
date: "2026-08-13"
description: "记录 AuraVLA 相机桥从帧计数刷新改为单调时钟、原子文件写入和序列元数据校验的工程实现。"
tags: ["AuraVLA", "Isaac Sim", "RGB-D", "ROS2", "工程实践"]
category: "tech"
references:
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 原问题

旧相机桥按 Isaac update 帧数刷新 RGB-D。渲染耗时和 GPU 推理负载变化时，帧数并不等于真实时间；感知端还可能同时读到上一帧 RGB、新一帧深度或未写完的元数据。

## 单调时钟刷新

当前实现使用 `time.monotonic()` 控制刷新，默认间隔为 `12 s`，不再依赖渲染帧率：

```python
now = time.monotonic()
if now - last_capture >= update_interval_sec:
    capture_once()
    last_capture = now
```

单调时钟不会受到系统时间回拨影响；刷新周期是配置项，非法的非正数直接拒绝。

## 原子图像与元数据

RGB、深度和 `metadata.json` 都先写入临时文件，再用 `os.replace()` 替换正式路径。每次采样递增 `sequence`，同时写入 `captured_at_unix`、相机 Prim、分辨率、深度范围和 `update_interval_sec`。

感知端应将 RGB、深度和 metadata 视为一个版本组：序列号不一致、文件时间过旧或 JSON 无法解析，都必须标记为 stale，而不是继续推理。

## 就绪与超时

AuraVLA 配置了相机帧最大年龄和刷新超时。启动器先加载 Isaac runtime，再等待相机桥产生有效 metadata；task bridge 的 `ready` 只表示执行桥已启动，不能代替 RGB-D 就绪。

恢复时保留最后一次错误原因，桥接成功后再清除；这样能区分 Isaac 未启动、相机 Prim 无效、深度读取失败和文件目录不可写。

## 验证方法

- 在写入 PNG/JSON 的中间时刻并发读取，确认读端不出现截断文件；
- 人为延迟深度帧，确认序列不一致时被拒绝；
- 修改系统时间，确认刷新周期仍然单调；
- 停止相机桥，确认感知端在最大帧龄后进入 stale；
- 恢复桥接后确认序列递增且旧错误被清除。

## 小结

RGB-D 桥的核心不是提高采样率，而是建立“这一组数据是否来自同一次采样”的证据。单调时钟控制节奏，原子写入保证完整性，序列元数据和帧龄阈值共同阻止旧帧进入 GraspNet。
