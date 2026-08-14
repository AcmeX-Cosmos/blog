---
title: "EKF 噪声整定：一组永远没生效的 yaml 参数"
date: "2025-06-07"
description: "Q 的分段常加速度构造、R 与观测量成比例的自适应设计，以及排查\"改了 yaml 却毫无反应\"时挖出来的参数名错位。"
tags: ["EKF", "状态估计", "调试", "ROS2", "C++"]
category: "research"
---

## 调 Q 没反应 - 2025-06-07

[9 维 EKF](/blog/ekf9-spintop-tracker) 的模型立住之后，剩下的工作就是整定 $Q$ 和 $R$。调了一下午 `sigma2_q_yaw`，从 50 拖到 300，跟踪曲线纹丝不动。

### 1. 现象描述

**预期行为**：`gimbal_control_params.yaml` 里改 `ekf.sigma2_q_yaw`，重启后偏航角估计的平滑程度应该有肉眼可见的变化。

**实际行为**：改任何值，`w_yaw` 的时序曲线完全一致，连小数位都不差。

**复现条件**：100%，改完必重启，参数文件路径也确认过被 launch 加载。

### 2. 排查过程

**假设 1：yaml 没被加载。** 验证方法是 `ros2 param list /vision_tracker_node | grep ekf`。结论：**不成立**，参数列表里 `ekf.` 开头的项都在。

**假设 2：代码读的是构造时的缓存值，没在 update 里重读。** 看代码，`SpinTopTracker::update()` 开头每帧都重新 `get_parameter`。结论：**不成立**。

**假设 3：参数名对不上。** 把 `ros2 param list` 的输出和 yaml 逐行对照，发现了这个：

```cpp
// spinTop_tracker.cpp —— 代码声明的名字
ekf_->s2q_x_   = node_ptr->declare_parameter("ekf.s2q_x",   15.0);
ekf_->s2q_y_   = node_ptr->declare_parameter("ekf.s2q_y",   10.0);
ekf_->s2q_z_   = node_ptr->declare_parameter("ekf.s2q_z",    5.00);
ekf_->s2qyaw_  = node_ptr->declare_parameter("ekf.s2qyaw",  100.0);
ekf_->s2qr_    = node_ptr->declare_parameter("ekf.s2qr",     80.0);
```

```yaml
# gimbal_control_params.yaml —— yaml 里写的名字
ekf:
  sigma2_q_x:   15.0
  sigma2_q_y:   10.0
  sigma2_q_z:   5.00
  sigma2_q_yaw: 150.0
  sigma2_q_r:   80.0
```

`s2q_x` ≠ `sigma2_q_x`。结论：**成立**。

### 3. 根因分析

`declare_parameter(name, default)` 的语义是：如果 yaml 里有同名项就用 yaml 的，没有就用 default，**并且静默接受**。yaml 里那五个 `sigma2_*` 项因为无人声明，会作为未使用参数被忽略（除非开 `allow_undeclared_parameters`），而代码这边五个 `s2q*` 全部落到默认值。

后果是 $Q$ 的五个噪声强度全程锁死在 `15.0 / 10.0 / 5.0 / 100.0 / 80.0`。其中四个碰巧和 yaml 写的一样，唯独 `sigma2_q_yaw` 是 150.0 而实际生效 100.0 —— 也就是说这半年所有关于\"偏航噪声该给多大\"的调参记录，全是在改一个没接线的旋钮。

同一个错误在云台控制里也有一份：

```cpp
max_tracking_w_yaw_ = node_ptr->declare_parameter("gimbal_control.max_tracking_w_yaw", 6.0);
```

```yaml
gimbal_control:
  max_tracking_v_yaw: 6.0     # w ≠ v
```

这次运气好，默认值和 yaml 值都是 6.0，所以没造成行为差异 —— 但它同样是坏的，改 yaml 一样不生效。

### 4. 解决方案

短期改法是把 yaml 的键名改成和代码一致。但这只是把两处约定对齐，下次还会错。

更稳的做法是让\"参数名对不上\"变成硬错误：

```cpp
// 节点构造时打开，未声明的 yaml 项会直接报错而不是被吞掉
rclcpp::NodeOptions options;
options.allow_undeclared_parameters(false);
options.automatically_declare_parameters_from_overrides(false);
```

或者把参数名抽成常量集中管理，yaml 生成也从同一处走 —— 但那对这个规模的项目有点重。

### 5. 顺带说清楚 Q 和 R 到底怎么构造的

既然挖开了，把这两个矩阵的设计写完整。

#### 5.1 Q：分段常白噪声加速度模型

把加速度当成方差为 $\sigma^2$ 的白噪声，在 $\Delta t$ 内积分到位置和速度上，得到每个二维子块：

$$
Q_{\text{blk}} = \sigma^2 \begin{bmatrix}
\dfrac{\Delta t^4}{4} & \dfrac{\Delta t^3}{3} \\[8pt]
\dfrac{\Delta t^3}{3} & \Delta t^2
\end{bmatrix}
$$

```cpp
double t_sq            = std::pow(t, 2);
double t_cube_over_3   = std::pow(t, 3) / 3;
double t_quart_over_4  = std::pow(t, 4) / 4;

Q.block<2,2>(0,0) << t_quart_over_4*s2q_x,   t_cube_over_3*s2q_x,
                     t_cube_over_3*s2q_x,    t_sq*s2q_x;          // X
Q.block<2,2>(2,2) << ...;                                          // Y
Q.block<2,2>(4,4) << ...;                                          // Z
Q.block<2,2>(6,6) << t_quart_over_4*s2q_yaw, t_cube_over_3*s2q_yaw,
                     t_cube_over_3*s2q_yaw,  t_sq*s2q_yaw;         // yaw
Q(8,8) = t_quart_over_4 * s2qr;                                    // r
```

标准推导里 $(1,2)$ 元是 $\Delta t^3 / 2$，这里写的是 $/3$。这个变体在工程实现中很常见（等价于对噪声在区间内做了不同的积分假设），会让位置-速度相关性略低一点，实际影响被 $\sigma^2$ 的整定吸收掉了。

$r$ 的过程噪声只有 $\Delta t^4/4$ 项 —— 因为半径在模型里是常量，没有对应的\"速度\"分量。给它一个非零的 $Q$ 是允许它缓慢漂移，用来吸收装甲板安装误差；给零的话它会被锁死在初值 0.25 m。

还有一行死代码：

```cpp
double s2q_w_yaw = this->s2qyaw_ / t_sq;   // 计算了，但从未被使用
```

大概是当初想给角速度分量单独的噪声强度，后来改成和角度共用 `s2q_yaw` 了，变量忘了删。

#### 5.2 R：与观测量成比例

$R$ 不是常量矩阵，每次 update 都按当前观测重算：

```cpp
void ExtendedKalmanFilter::update_R(const VectorXd &Z) {
    R.diagonal() << abs(r_x_ * Z[0]), abs(r_y_ * Z[1]), abs(r_z_ * Z[2]), r_yaw_;
}
```

$$
R = \operatorname{diag}\big(|r_x z_0|,\ |r_y z_1|,\ |r_z z_2|,\ r_\psi\big)
$$

设计意图是：单目视觉的测距误差随距离增长，远处目标的位置观测应该被给予更低的权重。用观测值本身当比例因子是最省事的实现。

三个坑：

**取绝对值是必须的。** $z_0$、$z_1$ 是 odom 系坐标，可以为负。没有 `abs` 的话 $R$ 会出现负对角元，协方差不再半正定，$S^{-1}$ 直接产生 NaN。

**目标经过原点时 $R \to 0$。** 观测值接近零意味着\"完全相信这个观测\"，卡尔曼增益趋于最大。实践中目标很少精确经过 odom 原点，所以没炸过，但这是个真实的奇异点。规范做法应该是 $R_{ii} = r_i \cdot (|z_i| + \epsilon)$ 或者干脆用距离 $\|z\|$ 而不是单分量。

**$r_\psi$ 是常量，不随观测缩放。** 这是对的 —— 角度观测的精度由 [BA 精化](/blog/pnp-ba-yaw-refine)决定，和目标远近无关。

#### 5.3 整定后的实际生效值

| 参数 | 代码默认（**实际生效**） | yaml 写的 | 是否生效 |
| --- | --- | --- | --- |
| `ekf.r_x` | 0.15 | 0.15 | ✅ 名字匹配 |
| `ekf.r_y` | 0.20 | 0.20 | ✅ |
| `ekf.r_z` | 0.25 | 0.25 | ✅ |
| `ekf.r_yaw` | 0.02 | **0.05** | ✅ 生效，用 yaml 的 0.05 |
| `ekf.s2q_x` | **15.0** | 15.0 | ❌ 名字错位，走默认 |
| `ekf.s2q_y` | **10.0** | 10.0 | ❌ |
| `ekf.s2q_z` | **5.0** | 5.0 | ❌ |
| `ekf.s2qyaw` | **100.0** | 150.0 | ❌ 值不同，yaml 无效 |
| `ekf.s2qr` | **80.0** | 80.0 | ❌ |

$\sigma^2_{q,\psi} = 100$ 远大于位置分量的 15/10/5，意思是\"对转速的模型预测很不自信\"。这符合物理直觉 —— 陀螺转速由对手操作手随时改变，匀速假设在角度维上最弱。

$r_z = 0.25 > r_y = 0.20 > r_x = 0.15$ 则反映单目深度精度最差。

### 6. 验证方法

- **参数生效自检**：启动后 `ros2 param get /vision_tracker_node ekf.s2qyaw`，和 yaml 对照。这一步以后应该固化进启动脚本
- **创新序列白化检验**：理论上 $\mathbf{z} - h(\hat{\mathbf{x}})$ 应该是零均值白噪声。把它录下来算自相关，若明显非白说明 $Q/R$ 比例失调
- **NEES 一致性检验**：$\epsilon = (\mathbf{z}-h)^\top S^{-1} (\mathbf{z}-h)$ 的均值应接近观测维数 4。显著偏大说明滤波器过于自信

---

下一篇是跟踪器外层的状态机：[PATROL / DETECTING / TRACKING / TEMP_LOST](/blog/tracker-state-machine-lost)。
