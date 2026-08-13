---
title: "[Daily] 从零搭起 RCIA-vision 的 ROS2 工作区"
date: "2024-03-16"
description: "colcon 工作区的目录约定、一键构建脚本 rb.sh 的演化，以及新人最容易卡住的 source 顺序问题。"
tags: ["ROS2", "colcon", "工程实践", "Linux"]
category: "daily"
---

## [Daily] ROS2 工作区搭建 - 2024-03-16

接手战队视觉代码的第一周，大部分时间不是花在算法上，而是花在"为什么我的包编不过"。这篇把踩过的坑记下来，免得下一届再问一遍。

## 目录约定

整个仓库按功能域切包，而不是按"一个大包塞所有源文件"：

```
RCIA-vision/
├── src/
│   ├── vision_interfaces/        # 自定义 msg，被所有包依赖
│   ├── vision_detector/          # 装甲板检测 + 数字分类
│   ├── rcia_math_solver/         # PnP 后的 BA 精化
│   ├── rcia_vision_tracker/      # EKF 跟踪 + 云台控制
│   ├── rcia_sensor_driver/       # 相机 / 串口驱动
│   │   ├── rcia_camera_driver/
│   │   └── rcia_serial_driver/
│   ├── vision_guard/             # 看门狗
│   ├── rcia_bringup/             # launch + 参数 yaml
│   └── rcia_robot_description/   # URDF
├── build/  install/  log/        # colcon 产物，全部 gitignore
└── rb.sh                         # 一键构建
```

拆包的直接好处是改一个检测参数不用重编整个跟踪链。`vision_interfaces` 单独成包是硬性要求——消息接口被所有 C++ 包依赖，混在业务包里会造成循环依赖。

## 构建脚本

最开始每次都手敲 `colcon build --symlink-install --packages-select ...`，敲错包名是家常便饭。后来固化成 `rb.sh`：

```bash
colcon build --symlink-install \
  --cmake-args -DCMAKE_BUILD_TYPE=Release \
  --parallel-workers 4
source install/setup.bash
```

三个选项都不是可选项：

`--symlink-install` 让 Python 脚本和 launch 文件以软链接方式安装。改一行 launch 就要重编一次的日子结束了。注意它对 C++ 不生效，改 `.cpp` 照样要重编。

`-DCMAKE_BUILD_TYPE=Release` 必须显式给。colcon 默认不带优化，Debug 构建下 OpenCV 的图像处理会慢一个数量级——第一次跑检测节点看到 8 FPS 时以为是算法写崩了，实际只是没开 `-O2`。

`--parallel-workers 4` 是给开发机降温用的。Ceres 和 OpenCV 的模板展开吃内存，全核并行时 16 GB 机器会 OOM 把编译进程杀掉，报错信息还特别难懂（`c++: fatal error: Killed signal terminated program cc1plus`）。

## 最常见的三个卡点

**source 顺序反了。** 必须先 `source /opt/ros/humble/setup.bash` 再 `source install/setup.bash`。反过来的话工作区的路径会被系统安装覆盖，表现是明明编译成功了 `ros2 pkg list` 却找不到自己的包。

**改了 msg 却不重编依赖包。** `vision_interfaces` 里加一个字段，只重编 interfaces 包是不够的，下游包链接的是旧的头文件。症状是运行时字段全是 0 而不是编译报错，非常难查。稳妥做法是改 msg 后连带重编所有依赖它的包。

**build/ 缓存脏了。** 换分支或者大改 CMakeLists 之后偶尔会出现"改了代码但行为没变"，删掉 `build/ install/` 重来是最快的解法，不值得花时间去查是哪个缓存文件坏了。

## 一点感受

ROS2 的工程复杂度有相当一部分不在代码里，而在构建系统和环境变量。这部分东西没什么技术含量但会实打实吃掉时间，早点固化成脚本比每次靠记忆强。

后面几篇会往上走：先是相机和串口驱动（[华睿相机 ROS2 驱动](/blog/huaray-camera-ros2-driver)、[串口协议与双缓冲](/blog/serial-protocol-double-buffer)），再进到检测和解算。
