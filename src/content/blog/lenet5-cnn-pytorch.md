---
title: "LeNet-5 手写数字识别：从零开始理解 CNN"
date: "2024-09-07"
description: "使用 PyTorch 从零实现 LeNet-5，理解卷积神经网络的基本原理，并在 MNIST 数据集上训练测试。"
tags: ["PyTorch", "CNN", "LeNet-5", "深度学习", "Python"]
category: "algorithm"
references:
  - title: "深度学习入门：基于 Python 的理论与实现"
    meta: "斋藤康毅. 陆宇杰译. 人民邮电出版社, 2018"
  - title: "Deep Learning"
    meta: "Goodfellow I, Bengio Y, Courville A. MIT Press, 2016"
---

## CNN 的直觉

在开始写代码之前，先建立对 CNN 的直觉理解：

- **全连接层的局限**：把图像展平成一维向量，完全丢失了空间结构信息
- **卷积核**：一个小的滑动窗口，检测局部模式（边缘、纹理等）
- **池化**：降采样，实现平移不变性并减少计算量

LeNet-5 是 Yan LeCun 在 1998 年提出的经典网络，虽然简单但包含了 CNN 的所有核心要素。

## 网络结构

```
Input (1x32x32)
  → Conv1 (6x28x28) → AvgPool (6x14x14)
  → Conv2 (16x10x10) → AvgPool (16x5x5)
  → FC1 (120) → FC2 (84) → Output (10)
```

## PyTorch 实现

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class LeNet5(nn.Module):
    def __init__(self, num_classes=10):
        super(LeNet5, self).__init__()

        self.conv1 = nn.Conv2d(1, 6, kernel_size=5, stride=1, padding=2)
        self.pool1 = nn.AvgPool2d(kernel_size=2, stride=2)

        self.conv2 = nn.Conv2d(6, 16, kernel_size=5)
        self.pool2 = nn.AvgPool2d(kernel_size=2, stride=2)

        self.fc1 = nn.Linear(16 * 5 * 5, 120)
        self.fc2 = nn.Linear(120, 84)
        self.fc3 = nn.Linear(84, num_classes)

    def forward(self, x):
        x = self.pool1(F.relu(self.conv1(x)))
        x = self.pool2(F.relu(self.conv2(x)))
        x = x.view(x.size(0), -1)  # Flatten
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        x = self.fc3(x)
        return x
```

## 训练与评估

```python
def train(model, train_loader, optimizer, criterion, device):
    model.train()
    for batch_idx, (data, target) in enumerate(train_loader):
        data, target = data.to(device), target.to(device)
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()

def evaluate(model, test_loader, device):
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for data, target in test_loader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            _, predicted = output.max(1)
            total += target.size(0)
            correct += predicted.eq(target).sum().item()
    return 100. * correct / total
```

## 从 LeNet-5 到 YOLO

LeNet-5 是 CNN 的起点。理解它之后，再看 YOLO 系列网络就能顺理成章：
- 卷积层提取特征（LeNet-5 的卷积层 → YOLO 的 Backbone）
- 特征图到输出的变换（LeNet-5 的 FC 层 → YOLO 的 Detection Head）
- 端到端训练思想一脉相承

这是深度学习的经典入门路径，也是我在 RoboMaster 中理解 YOLO 检测网络的基础。
