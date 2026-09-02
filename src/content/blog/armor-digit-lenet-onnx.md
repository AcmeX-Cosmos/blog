---
title: "装甲板数字分类：透视矫正、OTSU 与 ONNX 推理"
date: "2024-09-11"
description: "把倾斜装甲板拉正成 28×28 灰度图喂给 LeNet-5 ONNX，以及 blobFromImage 前那一次除法带来的隐蔽陷阱。"
tags: ["OpenCV", "ONNX", "LeNet-5", "深度学习", "C++"]
category: "algorithm"
references:
  - title: "机器学习实战（原书第 3 版）：基于 Scikit-Learn、Keras 和 TensorFlow"
    meta: "奥雷利安·杰龙. 宋能辉, 李娴译. 机械工业出版社, 2022"
  - title: "深度学习入门：基于 Python 的理论与实现"
    meta: "斋藤康毅. 陆宇杰译. 人民邮电出版社, 2018"
---

## 装甲板数字识别

灯条配对给出的是"这里有一块装甲板"，但打谁要看数字——1 号英雄、3/4/5 步兵、6 号前哨站，[跟踪器](/blog/ekf9-spintop-tracker)靠 `armor_pattern_idx` 锁定目标，[装甲板跳变处理](/blog/armor-jump-continuous-yaw)也依赖它判断是不是同一辆车。

训练部分在 [LeNet-5 从零实现](/blog/lenet5-cnn-pytorch) 那篇，这里只讲部署侧：怎么把一块透视变形的装甲板变成网络能吃的 28×28。

### 1. 问题定义

- **输入**：原始 BGR 图 + 配对得到的四个角点、`armor_type`
- **输出**：`armorPatternIdx`（1–9）与 `armorPatternAcc`
- **约束条件**：数字区域被两条灯条夹在中间，且随车身姿态严重倾斜

### 2. 透视矫正的尺寸约定

关键在于**目标坐标不是一个矩形，而是按灯条实际长度反推出来的布局**：

```cpp
static const int light_length       = 15;   // 灯条在矫正图中的像素长度
static const int warp_height        = 28;
static const int small_armor_width  = 30;
static const int large_armor_width  = 54;
static const cv::Size roi_size(20, 28);
static const cv::Size input_size(28, 28);

const int top_light_y    = (warp_height - light_length) / 2 - 1;   // = 5
const int bottom_light_y = top_light_y + light_length;             // = 20
const int warp_width = armor_type == "small_armor" ? small_armor_width : large_armor_width;

cv::Point2f target_vertices[4] = {
    cv::Point(0,              bottom_light_y),
    cv::Point(0,              top_light_y),
    cv::Point(warp_width - 1, top_light_y),
    cv::Point(warp_width - 1, bottom_light_y),
};
```

灯条只占矫正图高度的 15/28，上下各留 5 px 余量。这不是随意留白——真实装甲板上数字比灯条**高**，如果把灯条端点直接映射到图像上下边缘，数字的上下部分会被裁掉。留出的余量正好把完整数字框进来。

大板 54 px、小板 30 px 的宽度差，是因为两者灯条间距不同而数字大小相同。统一宽度会让小板数字被横向拉伸。

矫正后从中间裁 20×28，再缩放到 28×28：

```cpp
cv::warpPerspective(img, number_image, rotation_matrix, cv::Size(warp_width, warp_height));
number_image = number_image(cv::Rect(cv::Point((warp_width - roi_size.width) / 2, 0), roi_size));
cv::cvtColor(number_image, number_image, cv::COLOR_RGB2GRAY);
cv::threshold(number_image, number_image, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
cv::resize(number_image, number_image, input_size);
```

OTSU 自适应阈值在这里比固定阈值合理得多：矫正后的 ROI 只有 560 个像素，且天然是双峰分布（亮数字 + 暗底板），正是 OTSU 的理想输入。而且它对整体曝光免疫——同一个数字在强光和弱光下二值化结果几乎一致，这直接决定了分类器在光照变化下的鲁棒性。

顺带一提，角点顺序在这里被重排过：

```cpp
cv::Point2f lights_vertices[4] = {Draw_Box[3], Draw_Box[0], Draw_Box[1], Draw_Box[2]};
```

`getPerspectiveTransform` 要求源点和目标点一一对应，配对模块输出的是 LT/RT/RB/LB 顺序，而目标点是按左下→左上→右上→右下排的，所以要转一次。这种"两处顺序约定不一致，靠中间一行重排硬对上"的写法很容易在改动时踩雷，注释里应该写清楚而不是让人去数下标。

### 3. 推理

```cpp
cv::dnn::Net net = cv::dnn::readNetFromONNX(
    "/home/rcia/Desktop/RCIA_Vision/src/vision_detector/classify_model/lenet.onnx");

resized = PatternRoi / 255.0;
dnn::blobFromImage(resized, inputBlob);
net.setInput(inputBlob);
cv::Mat output = net.forward();

cv::Mat outputs = output.reshape(1, 1);
double confidence;
cv::Point class_id_point;
cv::minMaxLoc(outputs, nullptr, &confidence, nullptr, &class_id_point);
armorPatternIdx = class_id_point.x + 1;
armorPatternAcc = confidence;
```

`classify_model/` 下其实躺着五个模型：`lenet.onnx`、`mlp.onnx`、`mlp3s.onnx`、`mlp3pro.onnx`、`mlp_other.onnx`。是一路试过来的产物，最终选了 LeNet——MLP 在装甲板轻微旋转时掉点明显，卷积的平移不变性在这里是刚需。

### 4. 三个必须记下来的坑

**坑 1：模型路径是硬编码的绝对路径。** `/home/rcia/Desktop/...` 直接写死在成员初始化里，换台机器就崩，而且是在构造函数里静默失败——`readNetFromONNX` 找不到文件时返回空网络，直到第一次 `forward()` 才抛异常。正确做法是走 `ament_index_cpp::get_package_share_directory("vision_detector")` 拼路径，或者至少做成 ROS2 参数。这个改动一直没做，因为比赛机器就那一台。

**坑 2：`PatternRoi / 255.0` 不是你想的那个归一化。** `PatternRoi` 经过 `threshold` 后是 `CV_8U`，值域 {0, 255}。除以 255.0 之后 OpenCV 会把结果**饱和转换回 CV_8U**，得到的是 {0, 1} 的整型图，而不是浮点的 {0.0, 1.0}。

碰巧的是，二值图的这两种表示在数值上等价，所以网络照样能跑。但这纯属运气——如果哪天去掉 OTSU 改用灰度输入，这行会把整张图压成 0 和 1，信息全丢。规范写法是 `blobFromImage(PatternRoi, inputBlob, 1.0/255.0)`，用 `scalefactor` 参数做缩放，OpenCV 内部会正确转成 `CV_32F`。

**坑 3：`armorPatternAcc` 不是概率。** `minMaxLoc` 取的是网络输出层的**原始最大值**。ONNX 里如果最后一层没接 Softmax，这个值就是 logit，量纲取决于训练时的损失函数，可能是 12.7 也可能是 −3.2。把它当置信度做阈值判断（比如 `acc > 0.8` 才接受）是错的。要么在导出 ONNX 时带上 Softmax，要么在这里手动算：

$$
p_i = \frac{e^{z_i - \max_j z_j}}{\sum_k e^{z_k - \max_j z_j}}
$$

减最大值那步不能省，否则 logit 稍大就会 `exp` 溢出。

顺带说，头文件里声明了 `CheckFallbackCondition(int find_count)` 和 `UpdateHistory(int, double)`，配套的 `lastPatternIdx` / `lastPatternAcc` 成员也在——这是当初设计的"连续帧投票"机制，用历史结果给单帧误判兜底。但它们从未被实现和调用。目前的分类是纯单帧的，没有时序平滑。

### 5. 验证方法

- **离线混淆矩阵**：把比赛录像里的 ROI 全部导出，逐类统计准确率。1 和 7、3 和 8 是最容易混的两对
- **在线可视化**：`debug.cpp` 里把矫正后的 28×28 和预测结果画到调试窗口，实时看哪些姿态下会翻车
- **姿态覆盖**：正对、±45° 斜视、上下pitch各录一组

**评价指标**：分类准确率、逐类召回率、单帧推理耗时。

---

数字有了，位姿有了，下一步是把它们在时间上串起来：[9 维 EKF 状态建模](/blog/ekf9-spintop-tracker)。
