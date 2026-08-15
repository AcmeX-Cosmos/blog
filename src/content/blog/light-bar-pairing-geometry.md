---
title: "灯条配对的几何判据：从平行四边形到最小外接矩形"
date: "2024-07-06"
description: "两两配对的向量比例判据、中心高度差与长宽比二次筛选，以及 O(n²) 配对循环为什么必须有轮廓数上限。"
tags: ["OpenCV", "几何", "RoboMaster", "C++"]
category: "algorithm"
references:
  - title: "OpenCV 4 快速入门"
    meta: "冯振. 人民邮电出版社, 2020"
  - title: "FYT2024 Vision Project"
    meta: "CSU-FYT-Vision"
    url: "https://github.com/CSU-FYT-Vision/FYT2024_vision"
---

## 灯条配对与装甲板成型 - 2024-07-06

上一篇把灯条从图里抠了出来，但抠出来的是一堆孤立轮廓。哪两条属于同一块装甲板？这是一个组合问题加几何验证问题。

### 1. 问题定义

- **输入**：二值图上 `findContours` 得到的轮廓集合，数量 $n$
- **输出**：若干组四点 `vector<Point>{LT, RT, RB, LB}`，以及 `armor_type`（大板 / 小板）
- **约束**：配对是 $O(n^2)$，$n$ 必须被上游的 `max_contours = 50` 卡死

### 2. 判据一：向量比例构成平行四边形

两条灯条各取上下中点，凑成四个角点，再算四条边向量：

$$
\vec{v}_1 = RT - LT,\quad \vec{v}_2 = RB - RT,\quad \vec{v}_3 = LB - RB,\quad \vec{v}_4 = LT - LB
$$

理想平行四边形满足 $\vec{v}_1 = -\vec{v}_3$、$\vec{v}_2 = -\vec{v}_4$。代码只比 x 分量的比值：

$$
r_1 = \frac{v_{1x}}{v_{3x}},\qquad r_2 = \frac{v_{2x}}{v_{4x}},\qquad |r_1 - r_2| < \text{tolerance}
$$

```cpp
Point LT((first_BoxPoints[0]  + first_BoxPoints[1])  / 2.0);
Point RT((second_BoxPoints[0] + second_BoxPoints[1]) / 2.0);
Point RB((second_BoxPoints[2] + second_BoxPoints[3]) / 2.0);
Point LB((first_BoxPoints[2]  + first_BoxPoints[3])  / 2.0);

float ratio1 = (Vector_RBLB.x != 0) ? Vector_LTRT.x / Vector_RBLB.x
                                    : numeric_limits<float>::infinity();
float ratio2 = (Vector_LBLT.x != 0) ? Vector_RTRB.x / Vector_LBLT.x
                                    : numeric_limits<float>::infinity();

if (abs(ratio1 - ratio2) < detector_params.tolerance)
    return make_pair(vector<Point>{LT, RT, RB, LB}, "True");
```

分母为零时显式返回 `infinity()` 而不是让它自然产生 NaN —— `inf - inf` 是 NaN，NaN 参与任何比较都返回 false，会静默走进 else 分支；显式判断后单独返回 `"Error ratio"` 状态，至少调试时能看见。

只比 x 分量是个近似。装甲板在图像里近乎水平放置，y 方向的差异被下一道判据接管。

### 3. 判据二：最小外接矩形的三重筛选

```cpp
RotatedRect first_minRect  = minAreaRect(first_contour);
RotatedRect second_minRect = minAreaRect(second_contour);

// minAreaRect 的 width/height 语义不稳定，强制归一化
Fw > Fh ? swap(Fw, Fh) : void();
Sw > Sh ? swap(Sw, Sh) : void();

float Fa = fitEllipse(first_contour).angle;
float Sa = fitEllipse(second_contour).angle;
```

`minAreaRect` 返回的 width/height 取决于矩形的旋转角落在哪个象限，同一条竖直灯条可能被报成 "宽 5 高 40" 也可能是 "宽 40 高 5"。不做归一化，后面所有关于高度的判定都会随机失效。这是 OpenCV 里最经典的坑之一。

角度不用 `minAreaRect.angle` 而用 `fitEllipse().angle`：椭圆拟合用的是轮廓全部点的二阶矩，对灯条这种细长目标比外接矩形的角度稳定得多，后者在接近 45° 时会突然跳 90°。

三重筛选：

```cpp
// ① 两灯条中心 y 差不能超过较短灯条高度的 2 倍
if (myabs(Fy - Sy) > mymin(Fh, Sh) * 2)  return {{0,0,0}, {0,0,0}};

// ② 两灯条高度比不能过大
if (mymax(Fh, Sh) / mymin(Fh, Sh) >= detector_params.max_height_ratio)
    return {{0,0,0}, {0,0,0}};
```

再加上角度差 `angle_diff_thresh` 和整板长宽比区间 `[min_armor_ratio, max_armor_ratio]`。

### 4. 大板 / 小板判定

装甲板宽高比是区分依据：

$$
\text{type} = \begin{cases}
\text{large\_armor}, & W/H > 3.6 \\
\text{small\_armor}, & \text{otherwise}
\end{cases}
$$

这个判定的下游影响很大 —— [PnP 解算](/blog/pnp-ba-yaw-refine)会据此选择两套完全不同的 3D 模型点。判错一次，解出来的距离会差出几十厘米。

### 5. 调参经验

| 参数 | 取值范围 | 最优值 | 调整依据 |
| --- | --- | --- | --- |
| `tolerance` | 0.8 – 2.0 | **1.25** | 平行四边形比例容差。小于 1.0 时侧对装甲板（透视畸变大）会被误杀 |
| `max_height_ratio` | 1.2 – 2.0 | **1.5** | 两灯条高度比上限。斜视角下远端灯条会显著变短 |
| `min_armor_ratio` / `max_armor_ratio` | — | **1.5 / 8.0** | 整板宽高比区间，上限放到 8 是为了容纳极斜视角 |
| `armor_type_thresh` | 3.0 – 4.2 | **3.6** | 大小板分界，实测大板约 4.3、小板约 2.8，取中间偏大 |
| `angle_diff_thresh` | 5 – 15 | **7.5** | 两灯条倾角差（度） |
| `max_contours` | 20 – 100 | **50** | 配对是 $O(n^2)$ 的硬约束 |

#### 坑点

**配对复杂度必须设上限。** 场边有红色横幅时 `findContours` 返回过千轮廓，50 万次两两判定直接把节点卡死。`max_contours` 不是调参项，是保险丝。

**重复灯条判断不能省。** 三条灯条并排时，中间那条会同时和左右配成两块板。`repeated_light_judgment` 按面积/置信度保留一个。

### 6. 验证方法

- 二值图上叠加绘制配对结果的四点连线，目视检查
- 极端姿态样本集：正对、45° 斜视、部分遮挡、两车重叠
- 统计误配率：把明显不是装甲板的配对计数，占比应低于 1%

---

配到的四点还不够准，下一篇做亚像素修正：[基于 PCA 对称轴的角点精修](/blog/armor-corner-subpixel-pca)。
