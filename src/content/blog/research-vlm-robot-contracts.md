---
title: "VLM 机器人代理审计：语义权限、JSON 契约与有界重规划"
date: "2025-09-21"
description: "结合现有 Planner-Executor-Checker 实现，分析 VLM 在机器人系统中应该拥有什么权限，以及结构化输出、场景 grounding 和重规划怎样形成可验证闭环。"
tags: ["VLM", "机器人代理", "Isaac Sim", "系统安全", "结构化输出"]
category: "research"
references:
  - title: "ReAct"
    meta: "Yao et al. · ICLR 2023"
    url: "https://arxiv.org/abs/2210.03629"
  - title: "Code as Policies"
    meta: "Liang et al. · ICRA 2023"
    url: "https://arxiv.org/abs/2209.07753"
  - title: "VoxPoser"
    meta: "Huang et al. · CoRL 2023"
    url: "https://arxiv.org/abs/2307.05973"
---

## 权限边界比 prompt 更重要

S5 的代理链路把 VLM 输出限制为语义任务：`object_name`、`target_name`、任务是否可做及文字约束。Schema 递归拒绝 `pose`、`ik`、`joint_positions`、`trajectory`、`velocity` 和 `waypoints` 等运动字段。这个设计把系统分成两个信任域：VLM 负责理解“做什么”，确定性模块负责证明“怎样做不会越界”。

这比要求模型“谨慎输出”可靠。Prompt 是软约束，parser 和 executor capability 才是硬约束。即使模型遭遇视觉误判或指令注入，它也没有直接写关节轨迹的接口。

## 当前 JSON 契约已经解决了什么

`TaskPlan.from_agent_response()` 验证 `doable` 类型、任务白名单、必需名称、动作列表和重复动作；`PickPlaceExecutor` 顺序执行并在首个失败处停止；`ContainerChecker` 用场景几何验收；`RobotTaskOrchestrator` 最多重规划两次，并把上一次失败上下文反馈给 VLM。

因此一次任务不是“模型输出 -> 执行”，而是

```text
RGB-D + instruction
  -> semantic JSON
  -> schema validation
  -> deterministic execution
  -> physical checker
  -> bounded re-observation / replan
```

这个闭环可以记录每次 attempt 的 plan、execution 和 check，天然适合做失败分析。

## 仍然存在的三个接口风险

第一，`loads_json()` 会从混合文本中提取第一个 JSON 对象。它提高了模型兼容性，但也可能忽略对象后的第二段冲突内容。生产接口应要求响应整体就是一个对象，拒绝 trailing tokens，并验证 `schema_version` 等于服务端支持版本。

第二，`object_name` 与 `target_name` 仍是自由文本。Schema 只能证明字段存在，不能证明“banana”确实映射到当前场景唯一 Prim。需要独立 grounding 层返回稳定 `entity_id`、候选集合和置信度；出现同名实例时必须消歧，而不是把第一个字符串匹配结果交给执行器。

第三，默认 Checker 用物体中心是否落入容器 AABB 判断成功。对于旋转容器、非凸区域或大物体，这一判据会产生假阳性。更严格的验收应使用物体 OBB/mesh 与容器内部区域的包含比例，并在若干物理步后确认速度已经稳定。

## 重规划必须改变信息状态

“最多重试两次”只限制成本，不保证重试有意义。如果新一轮使用同一帧、同一 grounding 和同一执行参数，系统只是重复失败。每次 replan 至少应改变一项信息：重新采集 RGB-D、刷新场景实体、排除失败候选、切换机械臂、提高 hover clearance，或明确缩小任务范围。

可将重规划视为在失败证据 $e_k$ 下更新策略：

$$
\pi_{k+1}=f(o_{k+1}, instruction, plan_k, e_k, B_k),
$$

其中 $B_k$ 是剩余预算。失败证据必须是结构化枚举，例如 `NO_GROUNDING`、`NO_IK`、`COLLISION`、`GRASP_LOST`、`PLACE_OUTSIDE`，而不是只有自由文本 message。

## 建议的最小威胁模型

至少测试四类异常：模型输出非法字段；合法 JSON 中嵌套运动命令；场景不存在或同名目标；Checker 连续失败导致重试耗尽。系统应分别表现为 schema reject、permission reject、grounding reject 和 budget exhausted，且任何一种都不能产生关节动作。

还需要测试执行器异常：底层函数抛异常时，当前 adapter 会记录 traceback 并停止后续动作，这是正确的 fail-closed 方向；但日志对外展示前应清理绝对路径和环境信息，避免把内部系统细节反馈给不可信模型。

## 评价 VLM 的指标应与控制解耦

VLM 层报告实体 grounding accuracy、任务可行性判断、schema 合法率、危险字段拒绝率和一次规划正确率；执行层报告规划、抓取和放置指标；端到端再报告总成功率与平均尝试次数。三层分开后，才能判断提升来自更强模型、接口约束还是运动控制。

对你的系统而言，VLM 最合理的研究定位不是替代 GraspNet、IK 或 RRT，而是成为一个低权限语义规划器。它提供开放词汇与任务组合能力，几何模块则提供机器人能够信任的执行证据。
