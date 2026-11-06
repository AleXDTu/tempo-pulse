<div align="center">

<img src="app-icon.png" width="128" alt="Tempo Pulse">

# Tempo Pulse · 脉动时间节奏

**你的 8 小时，由你自己定义节奏的桌面伴侣。**

把工作日切成一段段时间块：什么时间认真工作、什么时间摸鱼、什么时间强制休息——全部说了算。

[![Release](https://img.shields.io/badge/release-v1.1.0-38bdf8)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-34d399)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)](https://tauri.app)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883)](https://vuejs.org)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

</div>

## ✨ 亮点

- 🗓️ **自定义时间表** — 多套模板按星期几自动生效；可视化 24 小时时间条；时间块支持拖动排序、下拉点选时间
- 🎭 **有反应的状态** — 不只是换颜色：休息 ☕ 弹休息屏、认真 💪 结束前 5 分钟收尾预告、摸鱼 🐟 结束前 2 分钟收敛预告 + ⌘⇧H 一键掩护；类型即行为，颜色表情随意改
- ⏯️ **开始 / 停止总开关** — 停止后完全安静（不计时、不提醒、不弹屏）；三处入口随时切换，状态持久化
- 🪟 **迷你悬浮窗** — 无边框置顶小窗常驻倒计时，可拖动、记住位置、跨桌面跟随（可配置）
- ☕ **强制休息屏** — 进入休息块自动接管：全屏或置顶小窗两种方式；背景（纯色/渐变/本地图片）与标题自定义，时间块备注自动成为副标题；两档强度（可跳过 / 锁死）
- 🎉 **法定工作日** — 内置 [holiday-cn](https://github.com/NateScarlet/holiday-cn) 权威数据并**自动更新**：法定节假日自动按周末节奏、调休补班日自动按工作日节奏，次年安排公布后无需升级应用
- 🧭 **三步引导** — 首次启动不迷茫：认识状态 → 选一个节奏预设（劳逸结合 55+5 / 深度工作 90+15）→ 立即开始
- 🫥 **托盘常驻** — 关掉窗口节奏照跑；托盘图标实时反映当前状态色；切换状态系统通知
- ⌨️ **全局快捷键** — ⌘⇧M 呼出主窗、⌘⇧B 切换迷你窗

## 🧭 工作方式

计时引擎跑在 **Rust 核心进程**（托盘常驻），主窗 / 迷你窗 / 休息屏三个窗口只是视图：

```
Rust 核心（唯一数据源）
├── engine   每秒计算快照；块切换 → 通知 / 休息屏（纯函数，单测覆盖）
├── holidays 法定节假日：内置 holiday-cn 离线数据 + 缓存 + 自动更新
├── windows  迷你窗 / 休息屏生命周期（置顶、全屏、拖动、位置记忆）
├── tray     托盘图标 = 当前状态颜色
└── commands 读快照 / 写配置（落盘后广播，多窗口天然一致）

Vue 3 视图层（Pinia + Tailwind）只订阅事件，不持有状态
pulse://tick · pulse://transition · pulse://config-changed
```

## 📦 安装

从 [Releases](https://github.com/AleXDTu/tempo-pulse/releases) 下载对应平台的安装包：

- macOS：`Tempo Pulse_x.x.x_aarch64.dmg`（Apple Silicon；打开后建议拖入「应用程序」）
- Windows：见 Release 附件

## 🛠️ 本地开发

```bash
# 依赖：Node 20+ / pnpm / Rust（macOS 需要 Xcode CLT，Windows 需要 WebView2 + MSVC）
pnpm install

pnpm tauri dev      # 启动开发版
cargo test          # 引擎与数据层单元测试（src-tauri 下）
pnpm tauri build    # 产出安装包
```

> 提示：若当前时刻正处在某个「休息」时间块内，启动应用会直接弹出休息屏——这是设计行为；不想被打扰可先在主窗点「⏸ 停止」。

## 🔒 数据与隐私

- **节奏数据完全本地存储**：`~/Library/Application Support/com.evanft.tempo-pulse/`（Windows 为 `%APPDATA%`），可随设置页一键直达
- **唯一的可选联网**：法定节假日数据自动更新（来源 holiday-cn，默认开启，可在设置中关闭；关闭后使用内置离线数据）
- 内置离线数据与官方《国务院办公厅关于部分节假日安排的通知》逐日一致

## ⌨️ 快捷键

| 快捷键 | 作用 |
|---|---|
| ⌘⇧M（Win: Ctrl⇧M） | 显示 / 隐藏主窗口 |
| ⌘⇧B（Win: Ctrl⇧B） | 显示 / 隐藏迷你悬浮窗 |
| ⌘⇧H（Win: Ctrl⇧H） | 🐟 摸鱼掩护：一键隐藏/恢复主窗与迷你窗 |
| Esc | 休息屏「可跳过」模式下关屏（休息继续，不算跳过） |

## 🗺️ Roadmap

- [x] v1.0 — 时间表 / 状态 / 迷你窗 / 休息屏 / 法定工作日 / 引导
- [x] v1.1 — 节假日数据自动更新
- [ ] 专注时长统计（区分认真与摸鱼）
- [ ] 萌宠互动（第二期，休息屏内容插件化）
- [ ] Windows 构建产物进 CI

## 🤝 贡献

Issue / PR 均欢迎。提交前请跑 `cargo test` 与 `pnpm build`。

## 📄 License

[MIT](LICENSE) © 2026 AleXDTu

<!-- TODO: 补充截图（主窗 / 迷你窗 / 休息屏），放入 docs/screenshots/ 并在此展示 -->
