---
title: "Isaac Sim 运行时桥：用幂等请求和心跳处理跨进程恢复"
date: "2026-07-24"
description: "拆解 AuraVLA 的 Isaac Sim 文件桥接协议：request_id 去重、原子 JSON、Owner Token、状态心跳和 VS Code runtime 恢复。"
tags: ["AuraVLA", "Isaac Sim", "ROS2", "文件桥接", "工程实践"]
category: "tech"
references:
  - title: "NVIDIA Isaac Sim Documentation"
    meta: "NVIDIA · Robot Simulation Platform"
    url: "https://docs.omniverse.nvidia.com/isaacsim/latest/index.html"
  - title: "ROS 2 Humble Documentation"
    meta: "Open Robotics · ROS 2"
    url: "https://docs.ros.org/en/humble/"
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
---

## 文件桥接的边界

AuraVLA 的 ROS 2 进程和 Isaac Sim 运行在不同执行环境，`aura_execution/aura_execution/task_bridge.py` 因此使用窄接口传递 JSON：客户端写入 `request.json`，Isaac 侧执行后写入 `response.json`，同时通过 `status.json` 发布运行状态。

这个协议不追求分布式消息队列的吞吐，它要解决的是三件事：请求不能重复执行，读端不能看到半个 JSON，运行时异常后客户端必须知道是否可以恢复。

## request_id 保证幂等

客户端每次提交生成新的 `request_id`，请求至少包含：

```json
{
  "request_id": "unique-id",
  "submitted_at_unix": 0,
  "plan": {"actions": []}
}
```

Isaac 侧只消费非空且不同于 `_last_request_id` 的请求，响应会原样带回 `request_id`。客户端等待响应时也必须匹配同一个 ID，不能因为 `response.json` 存在就把旧结果当成当前任务。

桥接启动时会读取已有 request 的 ID，避免进程重启后重复执行磁盘中残留的旧任务。请求缺少 ID 或 plan 不是映射对象时立即失败。

## 原子 JSON 与 Owner Token

所有状态、响应和请求文件先写入 `.tmp`，再调用 `os.replace()`。因此读端看到的始终是完整 JSON；解析失败应继续等待下一次完整写入，而不是清空状态或执行半个计划。

每个 `IsaacTaskBridge` 启动时生成随机 Owner Token，原子写入 `bridge.owner`。轮询前比较磁盘 Token 与进程持有值，热重载或旧进程失去所有权后不再消费请求。这是单机桥接的进程护栏，不应被描述成分布式锁。

## status 是可恢复状态机

`status.json` 至少区分以下状态：

| 状态 | 含义 | 客户端动作 |
| --- | --- | --- |
| `ready=true, state=idle` | 桥已启动，可接收新请求 | 允许提交 |
| `state=executing` | 当前 request 正在执行 | 等待同一 ID |
| `state=error` | 轮询或执行出现异常 | 读取 error，禁止盲目重放 |
| `ready=false, state=stopped` | 桥已停止 | 等待 runtime 恢复 |

heartbeat 默认每秒刷新；`FileTaskClient.is_ready()` 要求 `ready=true` 且 `updated_at_unix` 距当前不超过 `5 s`。因此 ready 是新鲜状态，不是启动时写过一次的永久标记。

## Isaac runtime 恢复

`aura_hardware/aura_isaac_bridge/isaac_runtime.py` 通过 VS Code Edition executor 加载 Isaac 源码，默认连接 `127.0.0.1:8226`，连接超时 `5 s`，task bridge ready 等待 `45 s`，执行超时 `300 s`。

恢复流程会重新注入 `AURA_VLA_ROOT`、Isaac bridge 根目录、相机目录和 Tron2 URDF 路径，并清理已加载的 `aura_isaac_bridge` 模块缓存。加载响应必须是 JSON 且 `status=ok`；空响应、非 JSON、脚本异常和 ready 超时分别报告，不能统一成“Isaac 未启动”。

相机恢复是独立步骤。runtime ready 后仍需确认相机 metadata 新鲜，task bridge 的心跳不能替代 RGB-D 就绪检查。

## 失败处理边界

客户端在执行前检查 bridge ready，提交后只接受 request_id 匹配的响应；超过 execution timeout 返回超时，不自动重复执行未知状态的任务。服务端无论执行成功还是异常，都写出包含 `request_id` 的 response，并把 `last_success` 和错误原因写入 status。

真正的运动规划约束由 Lula/RRT 和轨迹模块负责，文件桥只保证请求传输和生命周期可观察性。这样可以避免把桥接重试误当成规划恢复，也避免在不确定任务是否已执行时重复发送抓取动作。

## 验证清单

- 空 `request_id`、缺失 plan 和未知响应 ID 被拒绝；
- 并发读写 JSON 时读端不会得到截断对象；
- 重启后残留 request 不会再次执行；
- Owner Token 变化后旧进程停止消费；
- heartbeat 超过 `5 s` 后客户端报告 not ready；
- 执行异常仍产生同 ID 的失败 response；
- runtime 加载失败能区分连接、解析、脚本和 ready 超时。

## 小结

AuraVLA 的文件桥接不是把 JSON 当作临时日志，而是一个带幂等、所有权、心跳和超时语义的跨进程协议。它把“请求是否提交”“任务是否执行”“状态是否新鲜”和“是否可以恢复”分开记录，为 Isaac Sim 的热重载和闭环验证提供可审计边界。
