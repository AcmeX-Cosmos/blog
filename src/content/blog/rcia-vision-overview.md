---
title: "RCIA-vision 全景：一套 RoboMaster 自瞄系统的三年"
date: "2026-03-13"
description: "从相机出图到扣下扳机，再到 UE5 虚实闭环——RCIA-vision 十个 ROS2 包的分工、关键设计取舍与量化结果，兼作全系列文章的索引。"
tags: ["RoboMaster", "ROS2", "计算机视觉", "数字孪生", "系统架构"]
category: "tech"
references:
  - title: "rm_vision"
    meta: "华南师范大学 陈君"
    url: "https://gitlab.com/rm_vision"
  - title: "rmoss_core"
    meta: "RoboMaster OpenSource Software"
    url: "https://github.com/robomaster-oss/rmoss_core"
  - title: "FYT2024 Vision Project"
    meta: "CSU-FYT-Vision"
    url: "https://github.com/CSU-FYT-Vision/FYT2024_vision"
  - title: "rm.cv.fans"
    meta: "上海交通大学 方俊杰"
    url: "https://github.com/julyfun/rm.cv.fans"
---

## 这个项目是什么

RCIA-vision 是深圳职业技术大学 RoboMaster 战队的机器人视觉系统，我在 2023 年 9 月接手，负责核心算法。它要解决的问题一句话说得清：**在对抗中自动找到敌方机器人的装甲板，算出它下一刻在哪，把炮管指过去并在合适的时刻开火。**

难的地方在于每个环节都被现实条件卡着。装甲板是 13.5 cm 宽的一块反光板，5 m 外在图像上只有几十像素；对手会开"小陀螺"——底盘持续自旋，四块装甲板轮流转到正面，转速能到 6 rad/s 以上；弹丸初速约 26 m/s，打 5 m 目标飞行 0.19 s，这期间横移 2 m/s 的车已经走了 38 cm。

毕业设计在这套系统上又推进了一步：把它接进 UE5，做成虚实双向闭环的数字孪生验证框架。

## 整条流水线

```
相机回调 ──► 颜色分离 ──► 灯条配对 ──► 角点精修 ──► 数字分类
                                            │
                                            ▼
                            IPPE 初值 ──► 降自由度 BA ──► TF2 变换到 odom
                                                            │
                                                            ▼
                                    9 维 EKF ──► 装甲板选择 ──► 弹道补偿 ──► 串口
                                            │
                                            └──► WebSocket ──► UE5 虚拟场景
```

对应到代码，`src/` 下十个 ROS2 包：

| 包 | 职责 |
| --- | --- |
| `vision_interfaces` | 12 个自定义 msg，被所有包依赖 |
| `rcia_sensor_driver` | 华睿工业相机（IMV SDK）与串口驱动 |
| `vision_detector` | 装甲板检测、角点精修、数字分类、PnP |
| `rcia_math_solver` | Ceres 束调整精化 yaw |
| `rcia_vision_tracker` | 9 维 EKF、云台控制、弹道补偿、心跳 |
| `vision_guard` | 心跳看门狗 |
| `rcia_bringup` | launch 与参数 yaml |
| `rcia_robot_description` | 云台 URDF |
| `ros2_foxglove_bridge` | 现场调参与可视化（vendor 进仓库） |
| `vision_utils` | Python 测试脚本与弹道仿真 |

C++ 代码约 1.1 万行。

## 几个决定系统上限的设计

### 把四块装甲板看成一个旋转刚体

这是整套跟踪能成立的前提。如果直接跟"当前看到的那块装甲板"，目标每隔几十毫秒瞬移一次，任何运动模型都拟合不上。

正确的建模对象是**整车**：一个在平面上平动、同时绕竖轴旋转的刚体，四块装甲板固连在半径 $r$ 的圆周上。状态向量取

$$
\mathbf{x} = \begin{bmatrix} x_c & \dot{x}_c & y_c & \dot{y}_c & z_a & \dot{z}_a & \psi & \dot{\psi} & r \end{bmatrix}^\top
$$

装甲板跳变从"目标瞬移"变成"同一刚体的不同观测点"，运动模型立刻连续。更关键的是，$\dot{\psi}$（陀螺转速）在观测方程里的偏导整列为零——它**不可直接观测**，只能通过 $\psi$ 的时序变化被估计出来。而这个估计出来的转速，正是提前量解算必需的。

细节写在[9 维 EKF 整车建模](/blog/ekf9-spintop-tracker)。

### 用物理先验把六自由度压成一维

单帧 PnP 解出来的 yaw ，相邻两帧跳十几度是常态。装甲板四点共面，深度方向的约束天然薄弱。

处理办法不是上更强的优化器，而是**降维**。装甲板固定安装在机器人侧面，pitch 基本恒定（±15°）、roll 接近零，于是把旋转参数化成只含yaw的形式：

$$
R(\psi) = R_z(0) \, R_y(\psi) \, R_x(\phi_0)
$$

六自由度的束调整退化成单参数最小二乘，在 5 帧滑动窗口上联合求解。雅可比只有一列，`DENSE_QR` 几乎零成本，解空间是一维区间加了上下界不可能跑飞。yaw 抖动就是这么被压下去的。

同样的思路在项目里反复出现：[双半径互换](/blog/armor-jump-continuous-yaw)用几何先验替代滤波收敛，[弹道查表](/blog/ballistic-rk4-ceres)用实测曲线替代数值积分。算力和时间预算都紧的时候，先验往往比通用方法划算。

详见 [PnP + 降自由度 BA](/blog/pnp-ba-yaw-refine)。

### 四笔延迟账分开记

从相机曝光到弹丸命中，时间轴上叠了四层：

$$
\Delta t = \underbrace{t_{\text{now}} - t_{\text{stamp}}}_{\text{流水线耗时}}
+ \underbrace{t_{\text{flight}}}_{\text{飞行时间}}
+ \underbrace{t_{\text{pred}}}_{\text{软件链路}}
+ \underbrace{t_{\text{ctrl}}}_{\text{云台响应}}
$$

第一项是每帧实测的，不是参数。后三项分开是为了能单独标定——软件链路延迟改个 QoS 就会变，机械响应换电机才会变，混成一个参数就无法归因。

yaw 也要外推。位置外推错了偏几厘米，yaw 外推错了会打到隔壁那块板上。整条链路选的是"弹丸到达时**将会**正对我方的那块板"。

详见[飞行时间与多级延迟补偿](/blog/flight-time-delay-compensation)。

### 虚实双向闭环

传统做法是"纯仿真训练，纯现实部署"，仿真只当数据生成器。这个项目做的是双向：UE5 给实体算法提供高保真训练场，实体机器人的实时传感器数据反哺仿真环境。

技术难点不在渲染，在两个引擎对空间的定义不一样——ROS2 右手系米制，UE5 左手系厘米制，Y 轴反向。位置映射是

$$
\mathbf{p}_{ue} = 100 \cdot \operatorname{diag}(1, -1, 1) \cdot \mathbf{p}_{ros}
$$

姿态跟着手性翻，规律是"取反的轴自身不变号，另外两轴变号"。

原点对齐用的是装甲板本身当配准标记——整套感知链路本来就能高精度测装甲板位姿，不必再引入一套 ArUco。求解是经典的 Umeyama 问题，闭式解，但 SVD 之后那个 $\operatorname{diag}(1, 1, \det(VU^\top))$ 不能省，否则可能解出一个镜像而不是旋转。

详见 [UE5 桥接](/blog/ros2-ue5-bridge-coordinate)与[低延迟标记配准](/blog/marker-registration-latency)。

## 量化结果

| 指标 | 数值 |
| --- | --- |
| 位姿同步精度 | 优于 1.5° |
| 数据传输延迟 | 低于 5 ms |
| 虚拟弹道与真实弹着点误差 | 小于 5 cm |
| 验证效率 | 较传统方法提升 3 倍以上 |

关于"3 倍"这个数字，拆开看是三件事：不用排队等场地；`simulate_mode` 让视觉链路脱离实车运行，电控调固件时视觉不用停工；**偶发故障变成可复现故障**。第三点最被低估——实车上的跟踪发散观察了两周才确认规律，在虚拟环境里把它复现出来只用了几分钟。

赛场成绩方面，这套系统支撑了 RMUC 2024 全国赛国家二等奖、RMUC 2023 全国赛区域赛奖，以及 RMUL 2024/2025 的团体与哨兵项目。

## 也说说做砸的地方

写这一系列文章时把代码从头读了一遍，翻出来的问题比预想的多，而且没有一个是"算法不会"造成的：

`sigma2_q_*` 五个 EKF 噪声参数在 yaml 和 `declare_parameter` 里名字对不上（`s2q_x` vs `sigma2_q_x`），改了永远不生效——半年的调参记录在改一个没接线的旋钮。`solver_callback` 里 `if/else` 重复了一份，每帧跑两次 EKF 预测更新，而 `previous_time_` 从未赋值让 `dt_` 成了天文数字，两个 bug 互相掩盖，这也是调 $Q$ 一直没反应的另一半原因。`bullet_mass` 代码默认 0.003 kg、yaml 写 3.3 g，差 1000 倍，但弹道系数表是在错误单位下标定的所以整体自洽——谁"顺手修正"就会全部打飞。

还有伽玛 LUT 第二张表的指针指向了第一张、欧拉角提取公式漏了平方、平移 BA 建好 `problem2` 后 `ceres::Solve` 被注释掉每帧白建一个优化问题。

代价最大的不是 bug 本身，是它们互相掩盖时的排查成本。如果重来，三件事会不一样做：参数名从一处生成而不是 yaml 和代码各写一遍；单位写进变量名（`bullet_mass_kg`）；先写验证脚本再写算法。

完整清单在[数字孪生验证框架复盘](/blog/digital-twin-validation-efficiency)。

## 全系列索引

按技术难度递增：

**驱动与工程基础** — [ROS2 工作区搭建](/blog/ros2-workspace-bootstrap) · [华睿相机驱动](/blog/huaray-camera-ros2-driver) · [串口协议与双缓冲](/blog/serial-protocol-double-buffer)

**装甲板检测** — [通道相减与伽玛 LUT](/blog/armor-color-split-gamma) · [灯条配对几何判据](/blog/light-bar-pairing-geometry) · [PCA 角点亚像素精修](/blog/armor-corner-subpixel-pca) · [LeNet-5 ONNX 数字分类](/blog/armor-digit-lenet-onnx)

**系统架构** — [组件容器与零拷贝](/blog/ros2-component-container-zerocopy) · [TF2 消息过滤器](/blog/tf2-message-filter-odom)

**位姿与跟踪** — [PnP + 降自由度 BA](/blog/pnp-ba-yaw-refine) · [9 维 EKF](/blog/ekf9-spintop-tracker) · [装甲板跳变](/blog/armor-jump-continuous-yaw) · [Q/R 噪声整定](/blog/ekf-qr-adaptive-tuning) · [跟踪状态机](/blog/tracker-state-machine-lost)

**决策与控制** — [装甲板选择与开火判据](/blog/gimbal-armor-selection-fire) · [弹道补偿](/blog/ballistic-rk4-ceres) · [多级延迟补偿](/blog/flight-time-delay-compensation)

**可靠性与调试** — [心跳看门狗](/blog/guard-dog-heartbeat-tmux) · [Foxglove 在线调参](/blog/foxglove-dynamic-params)

**虚实闭环** — [UE5 桥接](/blog/ros2-ue5-bridge-coordinate) · [标记配准](/blog/marker-registration-latency) · [整链路复盘](/blog/digital-twin-validation-efficiency)
