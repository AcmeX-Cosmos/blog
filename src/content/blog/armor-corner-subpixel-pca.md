---
title: "灯条角点亚像素精修：PCA 对称轴与亮度梯度搜索"
date: "2024-08-22"
description: "用加权点云 PCA 求灯条主轴，沿轴向做亮度梯度极值搜索定位端点，把 PnP 输入的角点误差压到亚像素。"
tags: ["OpenCV", "PCA", "亚像素", "RoboMaster", "C++"]
category: "algorithm"
references:
  - title: "OpenCV 4 快速入门"
    meta: "冯振. 人民邮电出版社, 2020"
  - title: "Learning OpenCV 3: Computer Vision in C++ with the OpenCV Library"
    meta: "Bradski G, Kaehler A. O'Reilly Media, 2017"
---

## 灯条端点亚像素定位

上一篇配对拿到的四个角点，是两条灯条最小外接矩形上下边的**中点**。这个点的精度取决于 `minAreaRect` 拟合的质量，而后者对二值化的胖瘦极其敏感——阈值调高一格，灯条缩短两三个像素，角点跟着往里缩。

角点误差会被 PnP 放大成位姿误差。装甲板小板长约 135 mm，在 3 m 距离上成像宽度只有几十像素，2 px 的角点偏移换算到yaw上就是好几度。所以这一步必须做。

### 1. 问题定义

- **输入**：左右两条灯条的原始轮廓 `vector<cv::Point>`，以及整幅**灰度图**（不是二值图）
- **输出**：四个精修后的角点 `{LT, RT, RB, LB}`，`cv::Point2f` 精度
- **约束条件**：失败时必须能明确报告，不能返回一个"看起来还行"的错误点

失败语义写得很直白——四个点里任何一个没找到，整组作废：

```cpp
if (leftTopFound && rightTopFound && rightBottomFound && leftBottomFound) {
    corners = {LT, RT, RB, LB};
    status  = "True";
} else {
    corners = {cv::Point(0,0), cv::Point(0,0), cv::Point(0,0), cv::Point(0,0)};
}
```

宁可整块板不用，也不混一个精修点和三个粗糙点进 PnP——那样解出来的位姿反而比全用粗糙点更歪，因为残差分布不再是同分布的。

### 2. 数学原理

#### 2.1 亮度加权点云的主成分

灯条是一个细长的亮斑，它的主轴方向就是几何上的长轴方向。求主轴用 PCA，但不能对轮廓点做——轮廓只有边界，丢掉了内部的亮度分布。

做法是把 ROI 内的**亮度当作点的重复次数**，构造一个加权点云：

$$
\mathcal{P} = \bigl\{\, (j, i) \ \text{重复} \ \lfloor \tilde{I}(i,j) \rceil \ \text{次} \,\bigr\},
\qquad \tilde{I} = \text{normalize}(I,\ 0,\ I_{\max})
$$

亮度归一化到 $[0, 25]$，所以一个最亮的像素在点云里出现 25 次，暗像素出现 0 次直接不参与。这等价于对二阶矩做亮度加权：

$$
\Sigma = \frac{1}{|\mathcal{P}|}\sum_{p \in \mathcal{P}} (p - \bar{p})(p - \bar{p})^\top
$$

主轴方向取 $\Sigma$ 最大特征值对应的特征向量。

```cpp
constexpr float MAX_BRIGHTNESS = 25;
constexpr float SCALE = 0.07;

cv::Mat roi = gray_img(light_box);
float mean_val = cv::mean(roi)[0];
roi.convertTo(roi, CV_32F);
cv::normalize(roi, roi, 0, MAX_BRIGHTNESS, cv::NORM_MINMAX);

std::vector<cv::Point2f> points;
for (int i = 0; i < roi.rows; i++)
  for (int j = 0; j < roi.cols; j++)
    for (int k = 0; k < std::round(roi.at<float>(i, j)); k++)
      points.emplace_back(cv::Point2f(j, i));

auto pca = cv::PCA(cv::Mat(points).reshape(1), cv::Mat(), cv::PCA::DATA_AS_ROW);
cv::Point2f axis(pca.eigenvectors.at<float>(0,0), pca.eigenvectors.at<float>(0,1));
axis = axis / cv::norm(axis);
if (axis.y > 0) axis = -axis;     // 统一朝上，否则 top/bottom 会反
```

`MAX_BRIGHTNESS = 25` 是精度与开销的折中。数值越大点云越密、主轴越准，但内存和 PCA 耗时线性增长——25 意味着一个 40×10 的 ROI 最多产生一万个点，已经足够稳定。

`SCALE = 0.07` 把 ROI 向外扩 7%。不扩的话边界框正好卡在灯条上，端点处的亮度衰减被截断，梯度搜索找不到峰值。

方向归一化那句 `if (axis.y > 0) axis = -axis;` 看着不起眼，漏了会导致上下端点随机互换——PCA 返回的特征向量符号本身是不确定的。

#### 2.2 沿轴向的亮度梯度极值

有了主轴和质心，端点就在质心沿轴向 $\pm L/2$ 附近。在 $[0.4L,\ 0.6L]$ 的窗口内逐点前进，找亮度**下降最快**的位置：

$$
p^\star = \arg\max_{p} \bigl[ I(p_{\text{prev}}) - I(p) \bigr]
\quad \text{s.t.} \quad I(p_{\text{prev}}) > \bar{I}_{\text{roi}}
$$

```cpp
constexpr float START = 0.8 / 2;   // 0.40
constexpr float END   = 1.2 / 2;   // 0.60

int oper = (order == "top") ? 1 : -1;
float dx = axis.direction.x * oper;
float dy = axis.direction.y * oper;

int n = minRect.size.width - 2;      // 横向并列几条搜索线
int half_n = std::round(n / 2);
for (int i = -half_n; i <= half_n; i++) {
    float x0 = axis.centroid.x + L * START * dx + i;
    float y0 = axis.centroid.y + L * START * dy;
    // 沿 (dx, dy) 前进，记录最大亮度跌落处
    ...
}
```

两个设计点：

**多条平行搜索线取平均。** 单条线容易被一个坏像素带偏，代码沿灯条宽度方向开 $w-2$ 条线各找一次，最后对所有候选取算术平均。这既是去噪，也是把结果推到亚像素——多个整数坐标的平均自然落在像素之间。

**`I(prev) > mean_val` 这个前置条件是关键。** 没有它，搜索窗口外侧的暗区里任何一点噪声波动都可能被当成"最大跌落"。要求跌落起点必须亮于 ROI 均值，等于强制这个跌落发生在灯条本体的边缘上。

### 3. 工程实现

入口做了一道尺寸门槛：

```cpp
constexpr int PASS_OPTIMIZE_WIDTH = 3;

if (left_minRect.size.width > PASS_OPTIMIZE_WIDTH) {
    // 才做精修
}
```

灯条宽度不足 4 px 时（对应距离很远的目标），既拿不到足够的搜索线，PCA 的点云也退化成一条直线，主轴方向不可靠。这种情况直接跳过精修用原始角点——反而更安全。

`minAreaRect` 的 width/height 照例要先归一化：

```cpp
if (left_minRect.size.width > left_minRect.size.height)
    std::swap(left_minRect.size.width, left_minRect.size.height);
```

同[上一篇](/blog/light-bar-pairing-geometry)提到的坑，这里再犯一次的话，`L = minRect.size.height` 会拿到宽度，搜索范围完全错位。

**性能指标**：每条灯条一次 PCA（点云约 10⁴ 点）加 $w-2$ 条搜索线，两条灯条共四个端点。相比后面的 Ceres BA，这部分开销可以忽略。

### 4. 调参经验

| 参数 | 取值范围 | 最优值 | 调整依据 |
| --- | --- | --- | --- |
| `MAX_BRIGHTNESS` | 10 – 50 | **25** | 点云密度。低于 15 主轴抖动明显；高于 40 收益饱和但耗时翻倍 |
| `SCALE` | 0.03 – 0.15 | **0.07** | ROI 外扩比例。太小截断端点梯度，太大把邻近灯条框进来 |
| `START` / `END` | — | **0.40 / 0.60** | 搜索窗口占灯条长度的比例。窗口太窄会在灯条实际长度偏离拟合值时搜空 |
| `PASS_OPTIMIZE_WIDTH` | 2 – 5 | **3** | 精修的最小灯条宽度 |

#### 坑点与解决方案

**质心是 ROI 局部坐标，必须加回边界框原点。**

```cpp
cv::Point2f centroid = cv::Point2f(moments.m10/moments.m00, moments.m01/moments.m00)
                     + cv::Point2f(light_box.x, light_box.y);
```

漏掉后半截加法的话，所有角点会集中到图像左上角。这个错误的好处是症状极其明显，一眼就能看出来。

**ROI 扩展后必须做边界钳制。** 灯条贴着画面边缘时，扩 7% 会让 `light_box` 越界，`gray_img(light_box)` 直接抛异常。代码里四行 `std::max/std::min` 就是干这个的，不能省。

**搜索失败返回 `(-1, -1)` 而不是 `(0, 0)`。** 调用方用 `t.x > 0` 判定成功。如果失败返回 `(0,0)`，而目标真的在图像左上角，就区分不开了——虽然概率极低，但用负坐标做哨兵值是零成本的。

### 5. 验证方法

- **放大目视**：把原图 ROI 放大 8 倍，叠加绘制精修前后的角点，肉眼比较哪个更贴合灯条端点
- **重投影误差对比**：同一批样本，分别用粗糙角点和精修角点跑 PnP，比较重投影 RMSE
- **yaw 时序方差**：静止目标下录一段，看 `euler.y` 的标准差是否下降——这是最能反映实际收益的指标

**评价指标**：重投影 RMSE（px）、静态目标yaw标准差（deg）、精修成功率（四点全找到的帧占比）。

---

角点定完了，装甲板上还有个数字要认：[LeNet-5 ONNX 数字分类](/blog/armor-digit-lenet-onnx)。
