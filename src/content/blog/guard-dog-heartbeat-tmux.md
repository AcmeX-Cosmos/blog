---
title: "心跳看门狗：用 tmux 让视觉节点自己爬起来"
date: "2025-09-13"
description: "250 ms 轮询的心跳超时检测、通过 tmux 窗口重启整条视觉链路，以及看门狗重启自身时那段交替命名逻辑里的缺陷。"
tags: ["ROS2", "可靠性", "tmux", "C++"]
category: "tech"
---

## 视觉链路的进程级兜底

比赛中视觉节点崩掉意味着这台车接下来几分钟只能手动打。崩溃的原因五花八门——相机 USB 松动、驱动 SDK 内部异常、某个未捕获的 `cv::Exception`。挨个修是长期工作，但比赛当下需要的是**它能自己起来**。

这就是 `vision_guard` 包存在的理由：一个独立进程，盯着心跳，超时就把整条链路掀掉重开。

### 1. 接口定义

- **Topic**：`heartbeat`，队列深度 10
- **消息**：`HeartBeat.msg`

```
int32 heartbeat_id
builtin_interfaces/Time stamp
```

心跳由 `HeartBeatPublisher` 在[跟踪节点](/tracker-state-machine-lost)的回调里发出。这个选址很关键——心跳挂在**最下游**的节点上，意味着它隐含验证了整条链路：相机出图、检测出板、BA 解算、EKF 更新，任何一环卡住，心跳就断。如果把心跳发在相机节点里，检测崩了看门狗根本不知道。

### 2. 检测逻辑

```cpp
timer_ = this->create_wall_timer(250ms, std::bind(&GuardDog::check_heartbeat, this));

void GuardDog::check_heartbeat() {
    auto duration = this->now() - last_heartbeat_time_;

    if (duration.seconds() > 5.0 && !pause_) {
        pause_ = true;
        RCLCPP_ERROR(this->get_logger(), "HeartBeat timeout! No heartbeat for %.1f seconds.",
                     duration.seconds());
        restart_vision_node();
        restart_self();
        pause_ = false;
    }
}
```

5 秒的超时阈值是权衡出来的。设太短会误杀——比赛开局视野里没有敌人时，跟踪节点走的是 `PATROL` 分支，心跳频率会下降；设太长则崩溃后白白浪费几秒。5 秒对应最坏情况下丢掉大半个交火回合，但基本不会误触发。

`pause_` 标志防止重入。重启操作里有几个 `sleep_for(250ms)`，而定时器周期也是 250 ms，不加锁的话第二次超时检测会插进第一次重启的中间。

### 3. 用 tmux 而不是 systemd

重启走的是 tmux 窗口管理：

```cpp
void GuardDog::restart_vision_node() {
    execute_command("tmux kill-window -t rcia_vision:Vision");
    this_thread::sleep_for(250ms);
    execute_command("tmux new-window -t rcia_vision -n Vision -d "
                    "'bash /home/rcia/Desktop/auto_start.sh'");
    this_thread::sleep_for(250ms);
}
```

选 tmux 的理由很实际：**崩溃现场的日志要能翻出来**。systemd 重启后日志进 journald，比赛现场调机器时没人愿意去 `journalctl` 里翻；tmux 窗口可以直接 attach 上去看滚动输出，而且新建窗口不会清掉别的窗口。

构造函数里先确保会话存在，而且**不杀现有会话**：

```cpp
if (execute_command("tmux has-session -t rcia_vision") != 0) {
    if (execute_command("tmux new-session -d -s rcia_vision") != 0) {
        RCLCPP_FATAL(this->get_logger(), "Failed to create tmux session");
        rclcpp::shutdown();
        return;
    }
}
```

这条注释（`不杀死现有会话`）背后是个真实教训：早期版本每次启动都 `kill-session`，结果看门狗自我重启时把自己所在的会话干掉了，整个系统一起没。

### 4. 自我重启的交替命名

看门狗重启视觉节点之后，把自己也重启一遍——防止它自身状态出问题。麻烦在于不能在自己所在的窗口里杀自己，所以用了两个窗口交替：

```cpp
bool watchdog0_exists = (execute_command(
    "tmux list-windows -t rcia_vision -F '#{window_name}' | grep -x 'WatchDog0'") == 0);
bool watchdog1_exists = (execute_command(
    "tmux list-windows -t rcia_vision -F '#{window_name}' | grep -x 'WatchDog1'") == 0);

std::string new_window_name;
if (watchdog0_exists) {
    new_window_name = "WatchDog1";
    execute_command("tmux new-window -t rcia_vision -n WatchDog1 -d '...auto_watchDog.sh'");
    execute_command("tmux kill-window -t rcia_vision:WatchDog0");
} else if (watchdog1_exists) {
    execute_command("tmux new-window -t rcia_vision -n WatchDog0 -d '...auto_watchDog.sh'");
    new_window_name = "WatchDog0";
    execute_command("tmux kill-window -t rcia_vision:WatchDog1");
} else {
    execute_command("tmux new-window -t rcia_vision -n WatchDog1 -d '...auto_watchDog.sh'");
}

RCLCPP_INFO(this->get_logger(), "Restarted %s window", new_window_name.c_str());
rclcpp::shutdown();
```

先建新窗口再杀旧窗口，顺序不能反——反了的话新窗口还没起来，看门狗就已经不存在了。

**这段有三个问题**，记下来给自己长记性。

**第三个分支忘了赋值。** 两个窗口都不存在时创建了 `WatchDog1`，但 `new_window_name` 保持空字符串，日志打出来是 `Restarted  window`。不影响功能，但排查时会以为重启失败了。而且这个分支创建的是 `WatchDog1` 而不是注释里写的 `WatchDog0`，注释和代码不一致。

**`system()` 在 ROS 回调里同步阻塞。** `execute_command` 是 `system()` 的薄封装，每次调用 fork 一个 shell。看门狗只有一个定时器回调，阻塞几百毫秒没有实际危害，但这是个坏范式——同样的写法放进图像回调里会直接拖垮帧率。

**路径全部硬编码。** `/home/rcia/Desktop/auto_start.sh` 和 `auto_watchDog.sh` 写死在字符串里，和[数字分类的模型路径](/armor-digit-lenet-onnx)是同一类问题。换台机器就得改代码重编。

### 5. 联调结果

测试方法很粗暴——直接 `kill -9` 掉视觉进程，掐表看多久恢复：

```bash
tmux list-windows -t rcia_vision        # 看窗口在不在、名字对不对
ros2 topic hz /heartbeat                # 心跳频率
kill -9 $(pgrep -f component_container) # 手动制造崩溃
```

从杀进程到心跳恢复约 6–8 秒：5 秒超时 + 0.5 秒 tmux 操作 + 节点启动时间。这个数字在比赛里算长，但对比"整局手动"是能接受的。

要缩短只能压超时阈值，而阈值又受限于 `PATROL` 状态下的心跳频率。真正的解法是让心跳独立于跟踪状态——用一个固定频率的定时器发，而不是搭在业务回调上。这样阈值可以压到 1 秒。这个改动一直在待办里。

---

下一篇是调试基础设施：[Foxglove 动态调参与可视化](/foxglove-dynamic-params)。
