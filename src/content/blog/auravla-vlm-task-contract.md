---
title: "AuraVLA VLM 任务契约：把自然语言输出限制在可执行边界"
date: "2026-07-18"
description: "从 JSON Schema、动作去重、运动指令禁用字段到 VLM 失败重试，拆解 AuraVLA 的任务规划安全边界。"
tags: ["AuraVLA", "VLM", "Task Planning", "JSON Schema", "可靠性"]
category: "tech"
references:
  - title: "AuraVLA"
    meta: "Project implementation"
    url: "https://github.com/AcmeX-Cosmos/AuraVLA"
  - title: "ROS 2 Humble Documentation"
    meta: "Open Robotics · ROS 2"
    url: "https://docs.ros.org/en/humble/"
---

## 问题定义

让 VLM 直接生成关节角或轨迹，会把语言模型的格式错误、目标误识别和运动安全问题混在一次执行里。AuraVLA 将模型输出限定为任务意图，确定性规划器再根据当前场景生成抓取和放置动作。

## JSON 契约

规划器使用 `schema_version=1.0`，当前支持的任务集合只有 `pick_and_place`。可执行计划至少包含：

```json
{
  "schema_version": "1.0",
  "doable": true,
  "task": "pick_and_place",
  "actions": [
    {
      "action_id": "action-1",
      "task": "pick_and_place",
      "object_name": "banana",
      "target_name": "basket",
      "attributes": {}
    }
  ]
}
```

`doable=true` 但没有具体 action 时直接报错；未知任务、空对象名和空目标名不会进入执行器。相同的 `(task, object_name, target_name)` 只保留一次，避免模型重复描述导致同一物体被连续抓取。

## 禁止越权字段

Schema 校验会递归扫描对象和数组，拒绝以下字段：

```text
control, grasp_pose, ik, joint_positions,
joint_trajectory, pose, trajectory, velocity, waypoints
```

这不是简单的顶层字段检查。字段嵌套在 `attributes` 或 action 下面同样会失败，防止模型把底层控制命令藏在合法任务结构中。

## 容错解析不等于放宽校验

模型返回 Markdown 代码块时，解析器只去掉围栏；普通文本中混有解释时，解析器尝试提取第一个 JSON 对象。解析成功后仍必须执行完整 Schema 校验，不能因为“能解析”就接受不完整计划。

对不可执行请求返回 `doable=false` 和 `reason`，对机器人动作保持统一计划格式。这样上层可以区分用户意图不明确、目标不存在和模型输出非法，而不是依赖自然语言日志猜测。

## VLM 失败与重试

当前配置将图像长边限制为 `448`，历史消息最多保留 `2` 条，输出上限为 `768 tokens`，HTTP 可重试错误使用指数退避。多 API key 场景下并发请求，第一份能够通过 JSON 解析的响应获胜，其余请求取消。

重试只处理网络中断、429 和 5xx；模型返回结构合法但语义不可执行时，不应无限重试同一个提示，而应返回结构化失败原因交给规划器或用户。

## 验证方法

- 对嵌套 `pose`、`trajectory` 和 `waypoints` 构造负例，确认递归禁用生效；
- 对重复 action、空 action 和未知 task 做 Schema 单测；
- 模拟 Markdown、前置解释文本和截断 JSON，检查解析与校验边界；
- 分别模拟 429、5xx、超时和非法 JSON，确认重试次数有限；
- 保存原始响应、解析后的计划和失败原因，保证每次决策可复现。

## 小结

AuraVLA 的 VLM 只负责把语言映射为受限任务契约。安全性来自递归禁用底层字段、动作去重、有限重试和确定性执行器，而不是依赖 prompt 中的一句“不要输出控制指令”。
