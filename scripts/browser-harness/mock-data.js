/**
 * browser-harness 的命令返回值表和默认假数据。
 * 必须先于 mock-ipc.js 注入（mock-ipc.js 读 globalThis.__HARNESS_MOCK_DATA__）。
 *
 * 字段名与 src/lib/types.ts 一一对应（Rust 侧 serde camelCase）：
 *   PulseState / TimeBlock / Schedule / Settings / AppConfig / PulseSnapshot / TransitionPayload。
 * 以后后端加了新命令，只改这个文件：在 commands 里加一条默认返回值即可。
 */
(function (global) {
  "use strict";

  // ---- 基础数据（和 src/lib/types.ts 的接口逐字段对齐） ----

  // 四种状态：专注 / 休息 / 摸鱼 / 自定义（kind 见 types.ts 的 StateKind）
  const states = [
    { id: "st-focus", label: "专注", emoji: "🎯", color: "#b8bb26", kind: "focus" },
    { id: "st-rest", label: "休息", emoji: "🍵", color: "#83a598", kind: "rest" },
    { id: "st-slack", label: "摸鱼", emoji: "🐟", color: "#fabd2f", kind: "slack" },
    { id: "st-custom", label: "灵感", emoji: "✨", color: "#d3869b", kind: "custom" },
  ];

  const schedules = [
    {
      id: "sched-default",
      name: "工作日节奏",
      blocks: [
        { id: "blk-1", start: "09:00", end: "11:30", stateId: "st-focus", note: "上午深潜" },
        { id: "blk-2", start: "11:30", end: "12:00", stateId: "st-rest", note: null },
        { id: "blk-3", start: "12:00", end: "13:30", stateId: "st-slack", note: "午饭 + 摸鱼" },
        { id: "blk-4", start: "13:30", end: "18:00", stateId: "st-focus", note: null },
      ],
      activeDays: [1, 2, 3, 4, 5],
    },
  ];

  const config = {
    states,
    schedules,
    settings: {
      mini: { x: 1200, y: 80, visible: true, alwaysVisible: true },
      restScreen: {
        mode: "fullscreen",
        bgType: "color",
        bgValue: "#282828",
        title: "休息一下",
        strictness: "skippable",
      },
      legalDays: {
        enabled: true,
        holidays: ["2026-01-01"],
        workdays: ["2026-01-04"],
        autoUpdate: true,
        lastUpdated: "2026-11-01",
      },
      running: true,
      onboarded: true,
      theme: "dark",
      endReminders: true,
      autostart: false,
      notifications: true,
    },
  };

  // 引擎快照：now 故意不补零（"15:7:3"），和真实 Rust 引擎一致，
  // 用来验证 store 里 normalizeEngineClock 的补零逻辑
  const snapshot = {
    state: states[0], // 专注
    blockNote: "上午深潜",
    blockId: "blk-1",
    remainingSecs: 7 * 60 + 3,
    progress: 0.62,
    nextAt: "11:30",
    nextStateLabel: "休息",
    scheduleName: "工作日节奏",
    now: "15:7:3",
    isIdle: false,
    running: true,
  };

  // transition 载荷：专注 → 休息
  const transition = {
    from: states[0],
    to: {
      state: states[1],
      blockNote: null,
      blockId: "blk-2",
      remainingSecs: 30 * 60,
      progress: 0,
      nextAt: "12:00",
      nextStateLabel: "摸鱼",
      scheduleName: "工作日节奏",
      now: "15:7:3",
      isIdle: false,
      running: true,
    },
  };

  // 事件名与 src/lib/events.ts 的 EV 保持一致
  const events = {
    tick: "pulse://tick",
    transition: "pulse://transition",
    configChanged: "pulse://config-changed",
    restDismissed: "pulse://rest-dismissed",
  };

  // 写命令的模拟行为要用到的入口（函数在 invoke 时才执行，那时 __HARNESS__ 已就绪）
  const H = () => global.__HARNESS__;

  global.__HARNESS_MOCK_DATA__ = {
    // 模拟的窗口标签（getCurrentWindow / convertFileSrc 元数据用）
    windowLabel: "main",

    events,

    // ---- 命令表：值 = 直接返回（每次 invoke 都深拷贝）；
    //      函数 = 收前端传的 args，返回值即 invoke 结果。 ----
    commands: {
      // 读命令
      get_config: config,
      get_snapshot: snapshot,

      // 写命令：对应 commands.rs 的 persist_and_broadcast（写完广播 config-changed + tick）
      save_states: (args) => {
        H().emitEvent(events.configChanged, { ...config, states: args.states });
        H().emitEvent(events.tick, { ...snapshot });
        return null;
      },
      save_schedules: (args) => {
        H().emitEvent(events.configChanged, { ...config, schedules: args.schedules });
        H().emitEvent(events.tick, { ...snapshot });
        return null;
      },
      save_settings: (args) => {
        H().emitEvent(events.configChanged, { ...config, settings: args.settings });
        H().emitEvent(events.tick, { ...snapshot });
        return null;
      },
      set_running: (args) => {
        const snap = { ...snapshot };
        if (args.running) {
          snap.running = true;
        } else {
          // 停止时其余字段清零（对应 types.ts 对 running 的说明）
          Object.assign(snap, {
            running: false,
            state: null,
            blockNote: null,
            blockId: null,
            remainingSecs: 0,
            progress: 0,
            nextAt: null,
            nextStateLabel: null,
            isIdle: true,
          });
        }
        H().emitEvent(events.tick, snap);
        return null;
      },
      skip_current_block: () => {
        // 跳过后本块静默（视作空闲），下一个切换点照常
        H().emitEvent(events.tick, {
          ...snapshot,
          state: null,
          blockNote: null,
          blockId: null,
          isIdle: true,
          remainingSecs: 0,
          progress: 0,
        });
        return null;
      },

      // 其余窗口 / 系统命令：返回形状对了就行
      set_mini_visible: null,
      show_main_window: null,
      open_config_dir: null,
      toggle_game: null,
      open_game_dir: null,
      // 游戏用户资源探测：全部为 null → 浏览器里用内置占位图、无 BGM（静音不报错）
      get_game_assets: () => ({
        bgm: null,
        hero: { idle: null, run: null, jump: null, shoot: null, hurt: null },
      }),
      dismiss_rest_screen: null,
      save_rest_bg_image: () => "/mock-assets/harness-rest-bg.png",
      get_holiday_info: () => ({
        years: [2025, 2026],
        lastUpdated: config.settings.legalDays.lastUpdated,
      }),
      check_holiday_update: () => "节假日数据已是最新（browser-harness 模拟）",

      // 官方插件命令（main.ts 的通知权限、SettingsView 的版本号会调）
      "plugin:notification|is_permission_granted": true,
      "plugin:notification|request_permission": "granted",
      "plugin:app|version": "0.0.0-harness",
      "plugin:opener|open_url": null,
      // 游戏窗顶栏/菜单的关闭按钮（浏览器里点了没效果，只保证不报错）
      "plugin:window|destroy": null,
    },

    // pushTick / pushTransition / pushConfigChanged 的默认载荷
    defaults: { config, snapshot, transition },
  };
})(globalThis);
