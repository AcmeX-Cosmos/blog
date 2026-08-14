---
title: "弹道补偿：从 RK4 数值积分退回查表法的取舍"
date: "2025-09-06"
description: "含空气阻力的弹道微分方程与 RK4 离散化，Ceres 自动微分标定阻力系数，以及最终为什么线上跑的是一张十档系数表。"
tags: ["弹道", "RK4", "Ceres", "数值积分", "C++"]
category: "algorithm"
references:
  - title: "弹箭外弹道学"
    meta: "韩子鹏等. 北京理工大学出版社, 2014"
---

## 弹道下坠补偿 - 2025-09-06

17 mm 弹丸初速约 26 m/s，打 5 m 外的目标飞行时间约 0.19 s，重力下坠 $\frac{1}{2}gt^2 \approx 18$ cm。装甲板高度才 12.5 cm——不补偿的话，超过 4 m 基本打不中。

这篇记录两条路线：物理上正确的 RK4 数值积分，和线上实际在跑的查表法，以及为什么后者赢了。

### 1. 问题定义

- **输入**：目标在云台系下的位置 $\mathbf{p} = (x, y, z)$，初速 $v_0$，弹丸质量 $m$
- **输出**：补偿后的 pitch `pitch_rad`，以及用于显示的 `compen_height`、`distance`
- **约束条件**：每帧都要算，不能占用可观的时间预算

### 2. 数学原理

#### 2.1 含空气阻力的弹道方程

球形弹丸受重力和与速度平方成正比的阻力：

$$
m\ddot{\mathbf{r}} = -mg\hat{\mathbf{e}}_z - \frac{1}{2}\rho C_d A \|\dot{\mathbf{r}}\| \dot{\mathbf{r}}
$$

展开成两个分量：

$$
\begin{cases}
\ddot{x} = -\dfrac{\rho C_d A}{2m} \, v \, \dot{x} \\[8pt]
\ddot{y} = -g - \dfrac{\rho C_d A}{2m} \, v \, \dot{y}
\end{cases}
\qquad v = \sqrt{\dot{x}^2 + \dot{y}^2}
$$

阻力项让 $x$ 和 $y$ 方向耦合（都依赖合速度 $v$），方程没有解析解，只能数值积分。

#### 2.2 RK4 离散化

四阶龙格库塔对状态 $\mathbf{s} = (x, y, \dot{x}, \dot{y})$ 每步取四个斜率加权平均：

$$
\mathbf{s}_{n+1} = \mathbf{s}_n + \frac{h}{6}\left(\mathbf{k}_1 + 2\mathbf{k}_2 + 2\mathbf{k}_3 + \mathbf{k}_4\right)
$$

局部截断误差 $O(h^5)$，全局 $O(h^4)$。相比欧拉法的 $O(h)$，同样精度下步长可以放大一两个数量级。

代码里的实现（现在被注释掉了）：

```cpp
template <typename T>
void BallisticSystem::rk4_solver(T& x, T& y, T& vx, T& vy, T ax, T ay, T dt) {
    T k1_vx = ax * dt,                    k1_x = vx * dt;
    T k2_vx = (ax + T(0.5)*k1_vx) * dt,   k2_x = (vx + T(0.5)*k1_vx) * dt;
    T k3_vx = (ax + T(0.5)*k2_vx) * dt,   k3_x = (vx + T(0.5)*k2_vx) * dt;
    T k4_vx = (ax + k3_vx) * dt,          k4_x = (vx + k3_vx) * dt;

    vx += (k1_vx + T(2)*k2_vx + T(2)*k3_vx + k4_vx) / T(6);
    x  += (k1_x  + T(2)*k2_x  + T(2)*k3_x  + k4_x ) / T(6);
    // y, vy 同理
}
```

模板化是为了兼容 `ceres::Jet`——积分过程要能被自动微分穿透。

#### 2.3 用 Ceres 反标阻力系数

$C_d$ 的理论值（光滑球体）约 0.47，但实际弹丸有转速、表面不光滑、还有膛口扰流，真值只能实测。做法是用实测的"距离-补偿高度"对，把 $C_d$ 当未知量做最小二乘：

$$
C_d^\star = \arg\min_{C_d} \sum_{i} \left\| \mathbf{p}_{\text{sim}}(C_d, \theta_i) - \mathbf{p}_{\text{real},i} \right\|^2
$$

```cpp
problem.SetParameterLowerBound(&initialCd, 0, 0.01);
problem.SetParameterUpperBound(&initialCd, 0, 1.2);
options.trust_region_strategy_type = ceres::DOGLEG;
options.gradient_tolerance = 1e-8;
```

代价函数内部整条 RK4 积分链都是模板代码，Ceres 的 Jet 类型一路穿过去自动求出 $\partial \text{error} / \partial C_d$。这是自动微分最漂亮的用法之一——不用手推积分过程的导数。

实测数据表（0.5 m 一档，共 14 组）也在代码里：

```cpp
realData = {
    {0.157227, 0.5},  {0.314515, 1.0},  {0.47186,  1.5},
    {0.629262, 2.0},  {0.786717, 2.5},  {1.10178,  3.0},
    {1.25938,  3.5},  {1.25938,  4.0},  {1.41702,  4.5},
    {1.57471,  5.0},  {1.73243,  5.5},  {1.89019,  6.0},
    {2.04799,  6.5},  {2.20582,  7.0},
};
```

3.5 m 和 4.0 m 两行补偿值完全相同（1.25938）——这不是物理现象，是记录时抄重了。标定时这个重复点会给 3.5–4.0 区间一个错误的平台，而 3.0 m 那行（1.10178）相对前后又偏高。数据本身的质量限制了标定精度的上限。

### 3. 线上实际跑的：十档查表

上面那一整套 `BallisticSystem` 类——RK4、Ceres 标定、轨迹可视化、Marker 发布——在 `trajectory_compensator.hpp` 里**整个被注释掉了**，300 多行。真正编译进二进制的只有这个：

```cpp
double Trajectory_compensator::calculate_compensation_angle(double distance,
                                                            double firing_angle_rad)
{
    for (size_t i = 0; i < keys.size(); ++i)
        ballistic_coefficients[keys[i]] = values[i];

    auto it = ballistic_coefficients.lower_bound(static_cast<int>(distance));
    if (it == ballistic_coefficients.end())
        throw std::out_of_range("Distance out of range");

    const double adjusted_bc = it->second * distance;
    const double cos_theta   = std::cos(firing_angle_rad);

    const double numerator   = adjusted_bc * bullet_mass * acceleration_of_gravity * distance;
    const double denominator = 2 * initial_velocity * initial_velocity * cos_theta * cos_theta;
    return std::atan2(numerator, denominator);
}
```

形式上接近无阻力弹道的一阶补偿式

$$
\Delta\theta \approx \arctan\frac{g d^2}{2 v_0^2 \cos^2\theta}
$$

只是多乘了一个随距离查表得到的系数 $\text{bc}(d) \cdot d \cdot m$。

系数表：

| 距离档（m） | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bc | 0.45 | 0.355 | 0.245 | 0.175 | 0.125 | 0.085 | 0.055 | 0.038 | 0.0235 | 0.0185 |

系数随距离单调递减，近似几何衰减——它吸收的其实是公式里 $d^2$ 增长过快的部分，让整体曲线贴合实测。**这张表不是物理参数，是一条拟合出来的修正曲线。**

外层调用：

```cpp
void Trajectory_compensator::angle_compensator(const Eigen::Vector3d& target_position,
        double& pitch_rad, double& current_compen_height, double& current_distance) {
    const double distance  = std::sqrt(target_position(0)*target_position(0)
                                     + target_position(1)*target_position(1));
    const double angle_rad = std::atan2(target_position(2), distance);
    const double compen_rad = calculate_compensation_angle(distance, angle_rad);
    pitch_rad = angle_rad + compen_rad;
}
```

`distance` 只取水平投影（不含 $z$），和 $\text{atan2}(z, d)$ 配套——这是标准的球坐标分解。

### 4. 为什么查表赢了

**耗时。** RK4 每帧要积分几十步，还要外层用 Ceres 搜最优仰角；查表是一次 `lower_bound`（$O(\log n)$，$n=10$）加几次浮点运算。在已经有检测、BA、EKF 的流水线里，弹道这一环没有预算做数值积分。

**可调性。** 赛场上换一批弹丸、枪管磨损、气压变化，都会让弹道漂。查表法只要改十个数就能重新贴合，改完立刻通过 [Foxglove 动态参数](/blog/foxglove-dynamic-params)生效；RK4 那套要重跑标定。

**失败模式。** 数值积分在极端输入下可能不收敛或跑飞，查表法最差也就是抛 `out_of_range`。

代价是**外插能力为零**。表只覆盖到 9 m，超出直接抛异常；而且系数是针对某一个初速标的，换初速后整张表都得重标。

### 5. 调参经验与坑点

| 参数 | yaml 值 | 代码默认 | 说明 |
| --- | --- | --- | --- |
| `compensator.initial_velocity` | 25.8 | 26.0 | 初速（m/s），yaml 生效 |
| `compensator.bullet_mass` | **3.3** | **0.003** | 单位不一致，见下 |
| `bc_keys` / `bc_values` | 见上表 | 同 | 十档系数 |
| `compensator.pitch_offset` | 0.0 | 0.0 | 机械零位补偿 |
| `compensator.yaw_offset` | 0.0 | -0.025 | yaml 生效，覆盖成 0 |

**坑 1：`bullet_mass` 的单位差了 1000 倍。** 代码默认 `0.003`（kg），yaml 写的是 `3.3`（g）。yaml 会覆盖默认值，所以线上实际用的是 3.3。

这个数字直接乘在 `numerator` 上，意味着补偿角比按 kg 算大了三个数量级。但系统仍然能打中——因为 `bc_values` 那张表是**在 `bullet_mass = 3.3` 的前提下标出来的**，系数值被相应地压小了。两个错误互相抵消，整体标定是自洽的。

危险在于：谁要是"顺手"把质量改成 0.003 kg，补偿角会瞬间变成千分之一，弹全部打在地上，而且看代码完全找不出错——因为 0.003 kg 才是物理正确的值。这类"错得自洽"的参数必须在注释里写死单位，代码里现在没有。

**坑 2：`ballistic_coefficients` 每次调用都重建。** 那个 `for` 循环在每帧、每次调用时把 `keys`/`values` 重新填进 `std::map`。十个元素的红黑树重建不算贵，但完全没必要——应该在参数变化时才更新。

**坑 3：`lower_bound` 的语义是"第一个不小于"。** `static_cast<int>(distance)` 截断后查表，比如 3.7 m 截断成 3，`lower_bound(3)` 返回键 3 的项。所以 3.0–3.99 m 共用一个系数，档位之间是阶跃而非插值。近距离影响不大，远距离档位跨度相对误差更明显。加个线性插值是一行的事，一直没做。

### 6. 验证方法

- **静态打靶**：0.5 m 一档从 1 m 打到 7 m，每档 20 发，量弹着点与瞄准点的垂直偏差
- **与 Python 仿真对照**：`vision_utils/src/trajectory_simulation.py` 里有一份独立的 RK4 实现（`v0=26.0`、`Cd=2.7`、`dt=0.01`），用它画出理论弹道，和查表法的补偿角对比曲线，看两者在哪个距离段开始分叉
- **与 UE5 物理引擎对照**：论文里用 Chaos 物理引擎跑虚拟弹道，与实测弹着点误差小于 5 cm

**评价指标**：各距离档的弹着点垂直偏差均值与标准差、补偿角计算耗时。

---

补偿角算出来只是静态的，运动目标还要加提前量：[飞行时间与多级延迟补偿](/blog/flight-time-delay-compensation)。
