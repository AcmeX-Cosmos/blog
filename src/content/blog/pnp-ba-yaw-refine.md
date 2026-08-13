---
title: "[Algorithm] PnP + 降自由度 BA：从单帧位姿抖动到多帧偏航平滑"
date: "2025-03-08"
description: "RCIA-vision 中 IPPE 初值解算与 Ceres 束调整的工程实现：固定俯仰先验、只优化偏航角的单参数 BA，以及 Cauchy 核与历史帧窗口的整定。"
tags: ["PnP", "Ceres", "BA", "OpenCV", "C++", "RoboMaster"]
category: "algorithm"
---

## [Algorithm] 装甲板位姿解算与降自由度束调整 - 2026-03-08

单帧 PnP 在 RoboMaster 赛场上最难受的地方不是精度，而是**抖**。装甲板是一块近似平面的矩形，四个灯条角点在图像上张开的角度很小，深度方向的约束天然薄弱；再叠加曝光变化导致的角点亚像素漂移，解出来的偏航角在相邻两帧之间跳十几度是常态。而下游的 EKF 把 yaw 当作观测量之一，抖动会直接被放大成整车中心的乱飘。

这篇记录 `rcia_math_solver` 包里的处理思路：用 IPPE 拿一个稳定初值，再用一个**只有一个待优化参数**的束调整把偏航角在多帧上磨平。

### 1. 问题定义

- **输入**
  - `armor_2d_points`：4 个灯条角点，`geometry_msgs/Point32[]`，图像像素坐标
  - `armor_type`：`"small_armor"` / `"large_armor"`，决定使用哪套 3D 模型点
  - 相机内参 $K$（`camera_matrix.data`，9 元素）与畸变系数（5 元素）
- **输出**
  - `pnp_armor_rvec` / `pnp_armor_tvec`：Rodrigues 旋转向量与平移向量
  - `euler`：pitch / yaw / roll（角度制）
  - 经 BA 精化后发布为 `ArmorBaposeInfo`，含 `geometry_msgs/Pose`
- **约束条件**
  - 单帧必须在相机帧间隔内解完，BA 迭代不能拖累整条流水线
  - 偏航角要求平滑到能直接喂给 9 维 EKF 作观测（详见 [9 维 EKF 状态建模](/blog/ekf9-spintop-tracker)）

标定得到的内参里有个值得一提的细节：

```
fx = 1557.11    fy = 1735.10
cx = 640.10     cy = 512.00
```

$f_x$ 与 $f_y$ 相差约 11%，对常规方形像素的工业相机来说偏大。主点位置指向 1280×1024 的分辨率。这个不对称会直接进入重投影残差，后面调 Cauchy 尺度时要记住这一点。

### 2. 数学原理

#### 2.1 重投影残差

针孔模型下，3D 模型点 $P_i$ 经外参 $(R, t)$ 投影到像平面：

$$
\hat{p}_i = \pi(R P_i + t), \qquad
\pi\!\left(\begin{bmatrix} X \\ Y \\ Z \end{bmatrix}\right)
= \begin{bmatrix} f_x \dfrac{X}{Z} + c_x \\[6pt] f_y \dfrac{Y}{Z} + c_y \end{bmatrix}
$$

残差就是投影点与观测点之差，4 个角点给出 8 维残差向量：

$$
r(R, t) = \big[\,\hat{p}_0 - p_0,\ \hat{p}_1 - p_1,\ \hat{p}_2 - p_2,\ \hat{p}_3 - p_3\,\big]^\top \in \mathbb{R}^{8}
$$

#### 2.2 降自由度：把 6 维问题压成 1 维

完整外参有 6 个自由度。但装甲板在赛场上的姿态是**有强先验**的：它被固定安装在机器人侧面，俯仰角基本恒定，滚转角接近零。于是不把 $R$ 当自由变量，而是参数化成只含偏航的形式：

$$
R(\psi) = R_z(0) \, R_y(\psi) \, R_x(\phi_0), \qquad \phi_0 = \pm 15^\circ
$$

$\phi_0$ 的符号由装甲板类型决定 —— 代码里 `armor_pattern_idx == 6`（前哨站）取 $+15^\circ$，其余取 $-15^\circ$，对应装甲板向内还是向外倾斜。

于是优化目标退化为单参数最小二乘：

$$
\psi^\star = \arg\min_{\psi \in [\psi_{\min},\, \psi_{\max}]}
\sum_{k=1}^{N} \sum_{i=0}^{3} \rho\!\left( \big\| \pi\big(R(\psi) P_i + t_k\big) - p_i^{(k)} \big\|^2 \right)
$$

$N$ 是历史帧窗口长度，$\rho(\cdot)$ 是 Cauchy 鲁棒核：

$$
\rho(s) = a^2 \log\!\left(1 + \frac{s}{a^2}\right)
$$

单参数的好处很直接：雅可比只有一列，`DENSE_QR` 求解几乎零成本，且解空间是一维区间，加上下界后不可能跑飞。

### 3. 工程实现

- **依赖库**：OpenCV（`solvePnP` / `Rodrigues` / `getPerspectiveTransform`）、Eigen、Ceres Solver、ROS2 rclcpp

#### 3.1 初值：IPPE 而非 EPnP

```cpp
// vision_detector/src/pnp_solver.cpp
const vector<Point3f> &object_3d_points =
    (armor_identify_msg.armor_type == "small_armor")
        ? PNP::object_3d_points_small
        : PNP::object_3d_points_large;

bool found = solvePnP(object_3d_points, object_2d_point,
                      camera_info.camera_matrix, camera_info.dist_coeffs,
                      armor_rvec, armor_tvec, false, SOLVEPNP_IPPE);
```

这里用的是 `SOLVEPNP_IPPE`，不是 EPnP。选择理由是装甲板四点**共面**：IPPE（Infinitesimal Plane-based Pose Estimation）正是为平面目标设计的解析解法，对四点共面情形给出闭式解并同时返回两个候选姿态；EPnP 在共面退化配置下反而数值条件更差。四点输入时 IPPE 是 OpenCV 里最合适的选项。

#### 3.2 单参数代价函子

```cpp
// rcia_math_solver/src/ba_solver.cpp
class ReprojectionError1 {
public:
    ReprojectionError1(const vector<Point2f>& observed_,
                       const vector<double>& tvec_,
                       const double target_pitch_);

    template<typename T>
    bool operator()(const T* const initial_yaw, T* residuals) const;
    //  ↑ 唯一待优化参数        ↑ 8 维残差
};

// 8 residuals, 1 parameter
ceres::CostFunction* cost_function =
    new ceres::AutoDiffCostFunction<ReprojectionError1, 8, 1>(
        new ReprojectionError1(p2d, tvec, target_pitch_deg));

problem.AddResidualBlock(cost_function, loss_function, initial_yaw);
```

函子内部按 $R = R_z R_y R_x$ 拼出旋转矩阵，经 `Rodrigues` 转成轴角，再用 `ceres::AngleAxisRotatePoint` 旋转模型点。因为 Ceres 的自动微分要求全链路模板化，旋转矩阵用 `std::vector<std::vector<T>>` 承载，中间的矩阵乘法走 Eigen 的动态矩阵。

求解器配置：

```cpp
options.linear_solver_type       = ceres::DENSE_QR;
options.trust_region_strategy_type = ceres::LEVENBERG_MARQUARDT;
options.preconditioner_type      = ceres::JACOBI;
options.function_tolerance       = 1e-6;
options.parameter_tolerance      = 1e-6;
options.num_threads              = 1;
options.logging_type             = ceres::SILENT;
```

`num_threads = 1` 在这里**不是性能选择，而是正确性要求**。函子的 `operator()` 里会往全局变量写结果：

```cpp
g_reproject_rvec = (cv::Mat_<double>(3, 1) << P15R0_rvec[0].a, ...);
```

Ceres 是通过反复调用函子来求值和求导的，多线程下这个全局写会产生数据竞争。用全局变量把优化结果"捎带"出来是个便利写法，代价就是把并行度锁死在 1。单参数问题本来也快，暂时没有改的动力，但这属于需要在注释里写明的隐性耦合。

#### 3.3 历史帧窗口管理

```cpp
static const int optimizeLength_ = 5;   // 滑动窗口长度

void BA_CLASS::adjust_optimized_data(vector<Point2f>& object_2d_point) {
    rotations.emplace_back(g_reproject_rvec);
    translations.emplace_back(g_reproject_tvec);
    image_points.emplace_back(object_2d_point);

    if (rotations.size() > optimizeLength_) {   // 超窗口丢最老一帧
        rotations.erase(rotations.begin());
        translations.erase(translations.begin());
        image_points.erase(image_points.begin());
    }

    if (rotations.size() > 1) {
        double disDifference = sqrt(pow(translations[translations.size()-2].at<double>(0)
                                        - g_reproject_tvec.at<double>(0), 2));
        if (disDifference > 0.2) {              // 跳变：整窗作废
            rotations.clear(); translations.clear(); image_points.clear();
        }
    }
}
```

窗口内所有帧共享同一个 `initial_yaw` 参数块，本质是"用 5 帧观测联合约束一个偏航角"。这就是抖动被压下去的原因：单帧 8 个残差换成 40 个，同时观测噪声在最小二乘意义下被平均。

跳变检测只看 x 方向平移差，超过 0.2 m 就清空整个窗口。装甲板切换（陀螺旋转导致下一块板转到正面）时位置是阶跃的，如果不清窗，旧帧会把新姿态往回拽。

**性能指标**：单参数 + `DENSE_QR`，雅可比规模 $40 \times 1$，LM 迭代通常个位数收敛；相比六自由度全量 BA 的求解开销可以忽略。论文实测整链路位姿同步精度优于 1.5°。

### 4. 调参经验

| 参数 | 取值范围 | 最优值 | 调整依据 |
| --- | --- | --- | --- |
| `Ba_Param.yaw_optimization` | 0.01 – 1.0 | **0.05** | 偏航优化的 Cauchy 尺度。残差单位是像素，0.05 意味着几乎所有残差都落在核函数的对数压缩段 —— 这是**刻意**的强降权，让个别飘掉的角点无法主导解 |
| `Ba_Param.trans_vector_optimization` | 1.0 – 5.0 | **2.5** | 平移优化的 Cauchy 尺度，量级远大于偏航项，因为平移残差本身分布更宽 |
| `Ba_Param.maximum_yaw` / `minimum_yaw` | ±30° – ±60° | **±45°** | 超过 45° 时装甲板灯条投影严重压缩，角点定位精度崩塌，解出来的值没有意义，不如直接截断 |
| `optimizeLength_` | 3 – 8 | **5** | 3 帧平滑不足，8 帧在陀螺转速高时会引入明显滞后 |
| 跳变阈值 | 0.1 – 0.3 m | **0.2 m** | 小于 0.1 会被正常抖动误触发，整窗反复清空等于退化成单帧 |
| `TARGET_PITCH_DAG` | — | **15.0°** | 装甲板安装倾角的物理先验，不是调出来的 |

#### 坑点与解决方案

**坑 1：平移优化问题建了但没求解。** `bundle_adjustment()` 里完整构造了 `problem2`（三个平移分量各自作为一维参数块，上下界 ±0.05 m，配 `ReprojectionError2`），但真正的 `ceres::Solve(options2, &problem2, &summary2)` 调用连同结果回写一起被注释掉了。也就是说**平移量始终沿用 IPPE 的原始解，只有偏航被精化**。

这不完全是坏事：偏航是抖得最凶的量，而平移（尤其深度）在四点共面配置下本来就缺乏约束，硬优化容易越优化越飘。但代码现状是"每帧白建一个 Ceres Problem 再丢掉"，纯浪费。要么恢复求解，要么把这段建模删掉。

**坑 2：`ReprojectionError2` 在残差计算中做副作用。** 它在遍历角点时累加 `sum_X/Y/Z` 并除以 4 写进 `g_reproject_tvec`，还得用 `if constexpr (std::is_same<T, ceres::Jet<double,3>>::value)` 分支来剥 Jet 类型的实部。把"取值"和"求导"两条路径混在同一个函子里，是自动微分代码里典型的味道 —— 正确做法是求解结束后从参数块读取结果。

**坑 3：欧拉角提取公式漏了平方。** 从旋转矩阵取偏航角时写的是：

```cpp
armor_identify_msg.euler.y = atan2(-rotM.at<double>(2,0),
    sqrt(rotM.at<double>(2,1)*rotM.at<double>(2,1) + rotM.at<double>(2,2))
    * rotM.at<double>(2,2)) * (180.0/CV_PI);
```

标准公式是 $\psi = \operatorname{atan2}\big(-r_{20},\ \sqrt{r_{21}^2 + r_{22}^2}\big)$，这里 $r_{22}$ 没有平方，而且额外多乘了一个 $r_{22}$。同样的写法在 `pnp_solver.cpp` 和 `ba_solver.cpp` 里各有一份。所幸下游真正使用的是四元数形式的 `Pose`，这个 `euler` 字段主要用于调试显示，所以没有酿成跟踪失效 —— 但调试时看到的 yaw 数值是不可信的，排查问题时被它误导过一次。

### 5. 验证方法

- **单帧重投影检查**：把优化后的 $(R(\psi^\star), t)$ 重新投影回图像，叠加绘制在原始角点上。角点误差目视应在 1–2 px 内。
- **静态标定板对拍**：装甲板固定在已知偏航角的转台上，对比解算值与真值，覆盖 $\pm 45^\circ$ 区间。
- **动态时序曲线**：录制陀螺场景的 bag，用 Foxglove 画 `armor_bapose_info/euler.y` 的时序曲线，对比开启/关闭 BA 的曲线毛刺幅度 —— 这是判断平滑是否生效最直观的方式。
- **端到端指标**：论文实验部分给出位姿同步精度优于 1.5°，虚拟弹道与真实弹着点误差小于 5 cm。

**评价指标**：重投影 RMSE（px）、偏航角时序标准差（deg）、相邻帧偏航角一阶差分的 95 分位数。

---

**参考**

- Collins T., Bartoli A. *Infinitesimal Plane-Based Pose Estimation*. IJCV, 2014.（OpenCV `SOLVEPNP_IPPE` 的原始论文）
- Ceres Solver 官方文档：[Modeling Non-linear Least Squares](http://ceres-solver.org/nnls_modeling.html)
- 相关文章：[9 维 EKF 状态建模与调参](/blog/ekf9-spintop-tracker)、[弹道补偿与 RK4 数值积分](/blog/ballistic-rk4-ceres)
