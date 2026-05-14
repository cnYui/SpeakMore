# 首页统计与 JSON 持久化设计

## 背景

当前首页统计卡片仍是硬编码；历史数据保存在 renderer 的 `localStorage`；设置页有部分控件只是占位。用户确认本轮一次完成以下 4 件事：

1. 首页四个统计指标接真实数据。
2. 麦克风设备真实枚举，并让选择进入录音链路。
3. 历史记录和统计使用同一个主进程数据源。
4. 设置页移除或降级无真实能力的占位项。

诊断页深化不纳入本轮。

## 方案

采用 Electron 主进程 JSON 持久化，不引入正式数据库。主进程在 `app.getPath('userData')/local-data/` 下保存：

- `settings.json`：本地设置。
- `history.json`：语音历史记录数组。

renderer 不再直接把业务数据写入 `localStorage`。历史页、首页、设置页都通过 IPC 读写主进程 JSON 数据。

## 数据模型

历史记录字段：

- `id`
- `createdAt`
- `mode`
- `status`
- `rawText`
- `refinedText`
- `errorCode`
- `durationMs`
- `textLength`

设置字段：

- `showFloatingBar`
- `launchAtSystemStartup`
- `selectedAudioDeviceId`

`enableSoundEffects` 不再保留在 UI 中，因为当前没有真实声音效果行为。

## 首页统计口径

只统计成功记录：

- `总听写时长`：成功记录 `durationMs` 累加，按分钟显示。
- `累计听写字数`：成功记录 `textLength` 累加；保存记录时优先使用 `refinedText`，没有时使用 `rawText`。
- `平均速度`：`累计字数 / 总听写分钟数`，无有效时长显示 `--`。
- `节省时间`：以 `60 字/分钟` 的手打基准估算，`max(累计字数 / 60 - 实际听写分钟数, 0)`。

`整体个性化` 本轮不实现，首页该卡片保留视觉但显示“暂未启用”状态，避免继续展示假百分比。

## 麦克风设备

设置页通过 `navigator.mediaDevices.enumerateDevices()` 真实枚举输入设备。选中的 `deviceId` 保存到主进程设置 JSON。录音时从设置服务读取 `selectedAudioDeviceId`，并传入 `getUserMedia` 的 `deviceId` 约束。

主进程保留 `audio:get-devices-async` 通道以兼容旧调用，但不再作为设置页的数据源。

## 去占位

- `声音效果`：从设置页删除。
- `语言`：保留只读“简体中文 (zh-CN)”。
- `检查更新`：保留禁用按钮，文案明确为“暂未提供更新检查”。

## 风险与取舍

- JSON 存储不是并发数据库，但本地单窗口 Electron 场景足够。
- 统计即时从历史计算，历史上限保持 200 条，性能可控。
- 旧 `localStorage` 数据不做迁移，避免把临时原型数据带入正式本地数据源。
