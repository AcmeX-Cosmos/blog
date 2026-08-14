---
title: "9 维 EKF 整车建模：把四块装甲板看成一个旋转刚体"
date: "2025-04-12"
description: "状态向量 [xc, vxc, yc, vyc, za, vza, yaw, vyaw, r] 的物理含义、非线性观测方程与雅可比推导，以及为什么跟踪整车中心比跟踪单块装甲板稳。"
tags: ["EKF", "状态估计", "Eigen", "RoboMaster", "C++"]
category: "research"
---

## 陀螺目标的 9 维扩展卡尔曼滤波 - 2025-04-12

RoboMaster 的机器人会\"小陀螺\"——底盘持续高速自旋，四块装甲板轮流转到正面。如果直接跟踪\"当前看到的那块装甲板\"，目标会每隔几十毫秒瞬移一次，任何运动模型都拟合不上。

正确的建模对象不是装甲板，而是**整车**：一个在平面上平动、同时绕自身竖轴旋转的刚体，四块装甲板固连在半径为 $r$ 的圆周上。装甲板的跳变从\"目标瞬移\"变成了\"同一个刚体的不同观测点\"，运动模型立刻变得连续。

### 1. 问题定义

- **输入**：`OdomMeasurement`，即 odom 系下单块装甲板的 4 维观测 $\mathbf{z} = [x_a, y_a, z_a, \varphi]^\top$
- **输出**：`TargetSpinTop`，整车 9 维状态 + 双半径 + 高度差
- **约束条件**：偏航角速度可达 6 rad/s 以上，观测频率受限于图像帧率，模型必须在观测缺失时也能外推

### 2. 数学原理

#### 2.1 状态向量

$$
\mathbf{x} = \begin{bmatrix} x_c & \dot{x}_c & y_c & \dot{y}_c & z_a & \dot{z}_a & \psi & \dot{\psi} & r \end{bmatrix}^\top \in \mathbb{R}^{9}
$$

| 分量 | 含义 |
| --- | --- |
| $x_c,\ y_c$ | 整车旋转中心在 odom 系的水平坐标 |
| $\dot{x}_c,\ \dot{y}_c$ | 中心平动速度 |
| $z_a$ | **当前装甲板**的高度（不是车中心高度） |
| $\dot{z}_a$ | 高度变化率 |
| $\psi$ | 整车偏航角（连续化，不折叠到 $\pm\pi$） |
| $\dot{\psi}$ | 偏航角速度，即陀螺转速 |
| $r$ | 当前装甲板到旋转中心的水平半径 |

$z_a$ 用装甲板高度而非车中心高度，是因为同一辆车的四块装甲板高度往往不一致（前后两块低、左右两块高）。把它放进状态里，跳变时只需换值而不需要重建模型。

#### 2.2 状态转移：分量解耦的匀速模型

$$
f(\mathbf{x}, \Delta t):\quad
\begin{cases}
x_c \leftarrow x_c + \dot{x}_c \Delta t \\
y_c \leftarrow y_c + \dot{y}_c \Delta t \\
z_a \leftarrow z_a + \dot{z}_a \Delta t \\
\psi \leftarrow \psi + \dot{\psi} \Delta t \\
r \leftarrow r
\end{cases}
$$

四个速度分量和半径都视为常量。对应的雅可比是一个带偏移对角线的单位阵：

$$
F = \frac{\partial f}{\partial \mathbf{x}} = I_9 + \Delta t \sum_{k \in \{0,2,4,6\}} E_{k,\,k+1}
$$

```cpp
MatrixXd ExtendedKalmanFilter::jacobian_f(double pdt_) {
    MatrixXd F(9, 9);  F.setZero();
    F(0,0)=F(1,1)=F(2,2)=F(3,3)=F(4,4)=F(5,5)=F(6,6)=F(7,7)=F(8,8) = 1;
    F(0,1) = F(2,3) = F(4,5) = F(6,7) = pdt_;
    return F;
}
```

模型是线性的——严格说这部分不需要 EKF，非线性只出现在观测方程里。用 EKF 框架是为了统一处理。

#### 2.3 观测方程：非线性来源

相机看到的是装甲板，不是车中心。从状态反推观测：

$$
h(\mathbf{x}) = \begin{bmatrix}
x_c - r\cos\psi \\
y_c - r\sin\psi \\
z_a \\
\psi
\end{bmatrix}
$$

```cpp
VectorXd ExtendedKalmanFilter::h(const VectorXd & x) {
    VectorXd z(4);
    double cx = x(0), cy = x(2), cz = x(4), yaw = x(6), r = x(8);
    z(0) = cx - r * cos(yaw);
    z(1) = cy - r * sin(yaw);
    z(2) = cz;
    z(3) = yaw;
    return z;
}
```

三角函数是全部非线性的来源。对状态求偏导：

$$
H = \frac{\partial h}{\partial \mathbf{x}} =
\begin{bmatrix}
1 & 0 & 0 & 0 & 0 & 0 & r\sin\psi & 0 & -\cos\psi \\
0 & 0 & 1 & 0 & 0 & 0 & -r\cos\psi & 0 & -\sin\psi \\
0 & 0 & 0 & 0 & 1 & 0 & 0 & 0 & 0 \\
0 & 0 & 0 & 0 & 0 & 0 & 1 & 0 & 0
\end{bmatrix}
$$

代码里的注释把列名逐一标了出来，这个习惯在调试 9×4 矩阵时救命：

```cpp
//      xc   v_xc yc   v_yc za   v_za   yaw            v_yaw     r
J_h <<   1,   0,   0,   0,   0,   0,    r * sin(yaw),   0,      -cos(yaw),
         0,   0,   1,   0,   0,   0,   -r * cos(yaw),   0,      -sin(yaw),
         0,   0,   0,   0,   1,   0,    0,              0,       0,
         0,   0,   0,   0,   0,   0,    1,              0,       0;
```

注意 $\partial h / \partial \dot{\psi}$ 一整列全是零——角速度不可直接观测，只能通过 $\psi$ 的时序变化被间接估计出来。这是这个滤波器最核心的价值：**它把观测不到的转速估计了出来**，而转速正是[弹道提前量](/blog/gimbal-armor-selection-fire)必需的。

### 3. 工程实现

标准 EKF 两步：

```cpp
MatrixXd ExtendedKalmanFilter::exkalman_predict(const double &pdt_) {
    F = jacobian_f(pdt_);
    this->X_pred = f(this->X_prev, pdt_);
    update_Q(pdt_);
    this->P = F * this->P * F.transpose() + this->Q;
    this->X_prev = this->X_pred;
    return this->X_pred;
}

MatrixXd ExtendedKalmanFilter::exkalman_update(const VectorXd &Z) {
    update_R(Z);
    H = jacobian_h(this->X_pred);
    S = H * this->P * H.transpose() + R;

    if (S.determinant() == 0 || std::isnan(S.determinant())) {
        K = this->P * H.transpose() * S.completeOrthogonalDecomposition().pseudoInverse();
    } else {
        K = this->P * H.transpose() * S.inverse();
    }

    this->X_prev = this->X_pred + K * (Z - h(this->X_pred));
    this->P = (I - K * H) * this->P;
    return this->X_prev;
}
```

创新协方差 $S$ 的奇异性检查值得一提。$S$ 理论上正定，但 $r \to 0$ 或数值累积误差会让它接近奇异，直接求逆会喷 NaN 并污染整个状态。这里退化到 `completeOrthogonalDecomposition().pseudoInverse()`——用伪逆而不是直接放弃这一帧。代价是那一帧的增益不最优，但状态不会崩。

半径做了硬钳制：

```cpp
if (target_state(8) < 0.12) { target_state(8) = 0.12; ekf_->setState(target_state); }
else if (target_state(8) > 0.35) { target_state(8) = 0.35; ekf_->setState(target_state); }
```

$[0.12,\ 0.35]$ m 是 RoboMaster 车型的物理半径范围。$r$ 在观测方程里和 $\cos\psi$ 相乘，一旦被噪声推到负值，整个几何关系会翻转，中心估计瞬间飞到车的另一侧。钳制是硬保险。

初始化把中心放在装甲板后方 0.25 m：

```cpp
double r = 0.25;
double xc = xa + r * cos(yaw);
double yc = ya + r * sin(yaw);
target_state << xc, 0, yc, 0, za, 0, yaw, 0, r;
```

与 $h(\cdot)$ 的 $x_c - r\cos\psi$ 符号自洽——初始化和观测方程用反号是很容易犯的错，写的时候特意对了两遍。

### 4. 调参经验

| 参数 | 声明默认值 | yaml 值 | 说明 |
| --- | --- | --- | --- |
| `ekf.r_x` | 0.15 | 0.15 | x 观测噪声系数 |
| `ekf.r_y` | 0.20 | 0.20 | y 观测噪声系数 |
| `ekf.r_z` | 0.25 | 0.25 | z 观测噪声系数，最大——深度方向本来就最不准 |
| `ekf.r_yaw` | 0.02 | 0.05 | 偏航观测噪声，经 [BA 精化](/blog/pnp-ba-yaw-refine)后可以给得很小 |
| `tracker.max_match_distance` | 0.2 | 0.2 | 关联门限（m） |
| `tracker.max_match_yaw_diff` | 1.0 | 1.0 | 偏航关联门限（rad） |

$r_z > r_y > r_x$ 的排序反映了单目视觉的固有特性：横向（像素方向）精度高，深度精度低。给深度更大的观测噪声，滤波器就会更依赖模型预测而不是单帧测距。

#### 坑点

**$P$ 初始化为零矩阵。** 构造函数里 `P.setZero()`，而 $Q$、$R$ 都是 `setIdentity()`。$P = 0$ 意味着\"对初始状态完全确信\"，第一次 update 时 $K = P H^\top S^{-1} = 0$，观测被完全忽略。所幸 predict 步的 $P \leftarrow FPF^\top + Q$ 会让协方差从 $Q$ 开始生长，几帧之后就正常了。但严格说初始协方差应该给一个反映真实初始不确定度的对角阵，而不是靠 $Q$ 慢慢\"泡\"出来。

**噪声整定的细节单独成篇。** $Q$ 的分块构造、$R$ 与观测值成比例的设计、以及 yaml 里几个参数名对不上导致从未生效的问题，写在[EKF 噪声整定](/blog/ekf-qr-adaptive-tuning)里。

### 5. 验证方法

- **仿真直线运动**：给定匀速直线 + 固定转速的真值轨迹，注入高斯噪声，比较估计与真值
- **静止目标**：所有速度分量应收敛到零附近，$r$ 应稳定在真实半径
- **陀螺场景 bag 回放**：用 Foxglove 画 `spin_top_topic` 的 `w_yaw` 时序，与秒表数出来的实际转速对照
- **可视化**：`visualization_marker_array` 里发布中心 SPHERE 与四块装甲板 SPHERE_LIST，在 RViz/Foxglove 里看估计出的\"虚拟整车\"是否贴合实车

**评价指标**：中心位置 RMSE、转速估计误差、装甲板跳变后的收敛帧数。

---

跳变的处理是这套模型能跑起来的另一半：[装甲板跳变与连续化偏航](/blog/armor-jump-continuous-yaw)。
