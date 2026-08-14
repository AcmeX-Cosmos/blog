---
title: "[Algorithm] 装甲板灯条提取：通道相减、伽玛 LUT 与形态学取舍"
date: "2024-06-08"
description: "为什么用 R−B 通道相减而不是 HSV 阈值，红蓝两色为何一个腐蚀一个膨胀，以及查表法伽玛校正的实现细节。"
tags: ["OpenCV", "图像处理", "RoboMaster", "C++"]
category: "algorithm"
references:
  - title: "OpenCV 4 快速入门"
    meta: "冯振. 人民邮电出版社, 2020"
  - title: "学习 OpenCV（中文版）"
    meta: "于仕琪, 刘瑞祯. 清华大学出版社, 2009"
---

## [Algorithm] 敌方色灯条二值化 - 2024-06-08

自瞄的第一步是把装甲板两侧的灯条从画面里抠出来。灯条是高亮度的红色或蓝色 LED，看起来是个很简单的颜色分割问题，但赛场光照条件恶劣——顶灯直射、对手灯条反光、相机自动曝光跳变，任何依赖绝对色相的方法都会翻车。

### 1. 问题定义

- **输入**：`cv::Mat` BGR8，1280 × 1024
- **输出**：单通道二值图，敌方色灯条为白
- **约束**：整个二值化过程必须远快于帧间隔，因为后面还有配对、角点修正、PnP、BA 一整条链

### 2. 数学原理

不走 HSV，直接在 BGR 上做通道相减：

$$
I_{\text{red}}(x,y) = \max\big(0,\ R(x,y) - B(x,y)\big), \qquad
I_{\text{blue}}(x,y) = \max\big(0,\ B(x,y) - R(x,y)\big)
$$

再对差值图做固定阈值二值化：

$$
\text{out}(x,y) = \begin{cases}
255, & I(x,y) > \tau \\
0, & \text{otherwise}
\end{cases}
$$

通道相减比 HSV 好在哪？灯条是**自发光**的高亮区域，在 BGR 空间里主色通道会显著压过另一个通道，这个"差值"对整体亮度变化不敏感。而 HSV 的 H 分量在高饱和高亮度区反而不稳定——LED 中心过曝成白色时 H 完全失去意义，但 R−B 依然能给出正值。

### 3. 工程实现

```cpp
// vision_detector/src/armor_detector.cpp
void ArmorDetector::color_split(const Mat &img, const string enemy_color, Mat &out_img)
{
    vector<Mat> channels;
    split(img, channels);
    Mat B = channels[0];
    Mat R = channels[2];

    double maxval1 = 255;
    if (detector_params.enemy_color == "red") {
        Mat R_thresh;
        subtract(R, B, R_thresh);
        threshold(R_thresh, out_img, detector_params.red_thresh, maxval1, THRESH_BINARY);
        cv::erode(out_img, out_img, kernel);
    }
    else if (detector_params.enemy_color == "blue") {
        Mat B_thresh;
        subtract(B, R, B_thresh);
        threshold(B_thresh, out_img, detector_params.blue_thresh, maxval1, THRESH_BINARY);
        cv::dilate(out_img, out_img, kernel2);
    }
}
```

`cv::subtract` 而不是 `R - B`：OpenCV 的 `subtract` 对 `CV_8U` 做饱和截断，负值自动归零，正好对应上面公式里的 $\max(0, \cdot)$。用运算符重载写成 `R - B` 也是饱和的，但显式调用更清楚。

#### 红蓝为什么处理不对称

这是代码里最反直觉的一处：红色走 `erode`，蓝色走 `dilate`，用的还是两个不同的核。

原因在于两种灯条在相机上的成像特性不一样。红色 LED 在这套相机的 Bayer 滤镜下响应更强，容易过曝晕开，R−B 的高值区比真实灯条要胖一圈，所以腐蚀一次收回来。蓝色相反——蓝通道响应偏弱，远距离时灯条会断成几截，膨胀能把断点接上。

这个不对称不是理论推出来的，是把两种颜色的二值图并排看了一下午调出来的。换一款相机大概率要重调。

#### 伽玛校正走查表

构造函数里预生成 LUT：

```cpp
ArmorDetector::ArmorDetector(const DetectorParams &dp) : detector_params(dp)
{
    cv::Mat lookUpTable(1, 256, CV_8U);
    uchar* p = lookUpTable.ptr();
    for (int i = 0; i < 256; ++i) {
        p[i] = cv::saturate_cast<uchar>(pow(i / 255.0, 1.0 / gamma) * 255.0);
    }
    lut = lookUpTable;
    // ... lut2 同理，用于数字 ROI 的对比度增强
}
```

$$
\text{LUT}[i] = 255 \cdot \left(\frac{i}{255}\right)^{1/\gamma}
$$

逐像素调 `pow()` 对 130 万像素来说是不可接受的开销，查表把它降成一次内存访问。这是 OpenCV 里最经典的优化模式之一。

**这里有个真实的 bug**，写在这里给自己长记性：

```cpp
cv::Mat lookUpTable2(1, 256, CV_8U);
uchar* p2 = lookUpTable.ptr();      // ← 应该是 lookUpTable2
for (int i = 0; i < 256; ++i) {
    p2[i] = cv::saturate_cast<uchar>(pow(i / 255.0, 1.0 / gamma2) * 255.0);
}
lut2 = lookUpTable2;
```

`p2` 指向了第一个表，第二个循环把 `gamma2` 的结果写进了 `lookUpTable`，而 `lut2` 拿到的是一张**从未初始化**的表。复制粘贴改名漏了一个字符，编译器不会报——两个变量类型完全一样。表现是数字识别的对比度增强时好时坏（取决于未初始化内存的内容），排查了很久才发现问题不在分类器上。

### 4. 调参经验

| 参数 | 取值范围 | 最优值 | 调整依据 |
| --- | --- | --- | --- |
| `red_thresh` | 40 – 120 | **75** | 低于 60 会把地板红色反光收进来；高于 90 远距离灯条丢失 |
| `blue_thresh` | 40 – 120 | **75** | 与红色同值纯属巧合，两者是分别调的 |
| `min_contour_area` | 3 – 20 | **5.0** | 面积阈值，滤掉噪点。设太大会丢远距离目标 |
| `max_contours` | 20 – 100 | **50** | 轮廓数上限，防止极端光照下 `findContours` 返回上千个轮廓拖垮后续配对（配对是 $O(n^2)$） |
| `max_aspect_ratio` | 2.0 – 4.0 | **2.5** | 单个灯条外接矩形的宽高比上限 |

`max_contours` 这个保护是被现实教育出来的：有一场比赛场地边上有红色横幅，检测节点直接卡死。配对循环是两两组合，1000 个轮廓就是 50 万次判定。

### 5. 验证方法

- **静态图集**：存一批不同距离、不同曝光的图，二值化后目视检查灯条是否完整且无粘连
- **在线调参**：通过 [Foxglove 动态参数](/blog/foxglove-dynamic-params) 实时拖阈值，看二值图变化
- **回归**：改完参数跑一遍录制的 bag，统计检测率是否退化

**评价指标**：灯条召回率、单帧二值化耗时、误检轮廓数。

---

下一篇是配对：[灯条配对的几何判据](/blog/light-bar-pairing-geometry)。
