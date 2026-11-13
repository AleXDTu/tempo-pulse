/**
 * browser-harness 的 Tauri IPC 模拟层。
 * 在普通浏览器里安装 window.__TAURI_INTERNALS__，让 @tauri-apps/api 的
 * invoke / listen 全部走本地假数据，Vue 页面脱离 Rust 进程也能跑起来。
 *
 * 用法：先注入 mock-data.js（命令表），再注入本文件；两份文件按顺序
 * eval 即可，重复注入时后一次覆盖前一次。
 *
 * 实现语义对齐 node_modules/@tauri-apps/api@2.11.1 的调用约定：
 *   - invoke(cmd, args, options) 异步返回命令结果；
 *   - listen() 走 invoke('plugin:event|listen', { event, target, handler })，
 *     handler 是 transformCallback 返回的回调 id，listen 以该 id 作为 eventId；
 *   - unlisten() 会先裸调 window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener
 *     再 invoke('plugin:event|unlisten')，两处都要处理；
 *   - 事件回调收到的是 { event, id, payload } 形状的 Event 对象。
 */
(function (global) {
  "use strict";

  const DATA = global.__HARNESS_MOCK_DATA__;
  if (!DATA) {
    throw new Error(
      "[browser-harness] 请先注入 mock-data.js（globalThis.__HARNESS_MOCK_DATA__ 未定义）",
    );
  }

  // ---- 回调注册表（transformCallback / unregisterCallback / runCallback） ----

  let nextCallbackId = 1;
  /** id -> 包装后的回调 */
  const callbacks = new Map();

  function registerCallback(callback, once = false) {
    const id = nextCallbackId++;
    callbacks.set(id, (data) => {
      if (once) unregisterCallback(id);
      return callback && callback(data);
    });
    return id;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  function runCallback(id, data) {
    const cb = callbacks.get(id);
    if (!cb) {
      console.warn(`[browser-harness] 回调 ${id} 不存在（可能已注销）`);
      return;
    }
    cb(data);
  }

  // ---- 事件系统：事件名 -> 回调 id 列表 ----

  /** Map<string, number[]> */
  const listeners = new Map();

  function addListener(event, callbackId) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(callbackId);
  }

  function removeListener(event, callbackId) {
    const ids = listeners.get(event);
    if (!ids) return;
    const i = ids.indexOf(callbackId);
    if (i !== -1) ids.splice(i, 1);
    if (ids.length === 0) listeners.delete(event);
    unregisterCallback(callbackId);
  }

  function dispatch(event, payload) {
    for (const id of [...(listeners.get(event) ?? [])]) {
      runCallback(id, { event, id, payload });
    }
  }

  // ---- 命令表 ----

  /** Map<cmd, 值或函数>；安装时从 mock-data 拷一份，setCommand 只改这份 */
  const commandTable = new Map(Object.entries(DATA.commands));

  /** 记录每次 invoke，供外部断言“页面确实调了某个命令” */
  const calls = [];

  async function invoke(cmd, args = {}, _options) {
    calls.push({ cmd, args });

    // 事件插件命令由本层接管（@tauri-apps/api 的 listen/unlisten/emit）
    if (cmd === "plugin:event|listen") {
      addListener(args.event, args.handler);
      return args.handler; // 以回调 id 作为 eventId（与官方 mock 一致）
    }
    if (cmd === "plugin:event|unlisten") {
      removeListener(args.event, args.eventId);
      return null;
    }
    if (cmd === "plugin:event|emit") {
      // 前端 emit → 只广播给本页监听器（真实后端会广播到所有窗口，浏览器里只有本页）
      dispatch(args.event, args.payload);
      return null;
    }

    const entry = commandTable.get(cmd);
    if (entry === undefined) {
      throw new Error(
        `[browser-harness] 未配置的命令 "${cmd}"，用 __HARNESS__.setCommand("${cmd}", ...) 补上`,
      );
    }
    // 表里是函数：函数自己负责返回值（含广播等副作用）；
    // 表里是值：深拷贝后返回，页面改返回值不会污染命令表
    return typeof entry === "function" ? await entry(args) : structuredClone(entry);
  }

  // ---- 安装 __TAURI_INTERNALS__ / __TAURI_EVENT_PLUGIN_INTERNALS__ ----

  const windowLabel = DATA.windowLabel ?? "main";

  global.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: registerCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    // getCurrentWindow() / 多窗口插件读的元数据
    metadata: {
      currentWindow: { label: windowLabel },
      currentWebview: { windowLabel, label: windowLabel },
    },
    // 休息屏背景图等本地文件路径 → URL（macOS 风格；指向不存在的路径，图片会裂但不崩）
    convertFileSrc: (filePath, protocol = "asset") =>
      `${protocol}://localhost/${encodeURIComponent(filePath)}`,
  };

  // @tauri-apps/api 2.11.x 的 _unlisten 会裸调这里，缺失会 TypeError
  global.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, eventId) => removeListener(event, eventId),
  };

  // 真实 Tauri 环境会注入的标记
  global.isTauri = true;

  // ---- 对外控制面：外部脚本用 __HARNESS__ 驱动页面 ----

  function clone(v) {
    return v === undefined ? undefined : structuredClone(v);
  }

  const HARNESS = {
    /** 设置命令返回值：值为直接返回，函数收 (args)；可用来加新命令 */
    setCommand(cmd, valueOrFn) {
      commandTable.set(cmd, valueOrFn);
    },
    /** 读命令当前配置的返回值（函数原样返回） */
    getCommand(cmd) {
      return commandTable.get(cmd);
    },
    /** 恢复 mock-data.js 里的初始命令表，并清空调用记录 */
    reset() {
      commandTable.clear();
      for (const [k, v] of Object.entries(DATA.commands)) commandTable.set(k, v);
      HARNESS.clearCalls();
    },

    /** 广播任意事件（载荷原样发给所有监听器） */
    emitEvent: dispatch,
    /** 推一条 tick；patch 浅合并到 defaults.snapshot 上（只改想改的字段） */
    pushTick(patch = {}) {
      dispatch(DATA.events.tick, { ...clone(DATA.defaults.snapshot), ...patch });
    },
    /** 推一条 transition；patch 可含 from 和 to（to 浅合并到 defaults.transition.to）。
     *  from 用 !== undefined 判断：显式传 null（应用启动首帧的载荷）必须原样生效，
     *  ?? 会把 null 当「没传」换成默认的专注状态 */
    pushTransition(patch = {}) {
      const base = clone(DATA.defaults.transition);
      dispatch(DATA.events.transition, {
        from: patch.from !== undefined ? patch.from : base.from,
        to: { ...base.to, ...(patch.to ?? {}) },
      });
    },
    /** 广播 config-changed（不传则发默认 config） */
    pushConfigChanged(config) {
      dispatch(DATA.events.configChanged, config ?? clone(DATA.defaults.config));
    },
    /** 广播 rest-dismissed（休息屏被引擎关闭） */
    pushRestDismissed() {
      dispatch(DATA.events.restDismissed, undefined);
    },

    /** 当前已注册的事件监听器：{ 事件名: [回调 id...] } */
    listeners() {
      const out = {};
      for (const [event, ids] of listeners) out[event] = [...ids];
      return out;
    },
    /** 某个事件的监听器个数（常用来断言页面订阅了某事件） */
    listenerCount(event) {
      return listeners.get(event)?.length ?? 0;
    },

    /** invoke 调用记录 [{ cmd, args }]；clearCalls 清空 */
    calls,
    clearCalls() {
      calls.length = 0;
    },

    /** 切换模拟的窗口标签（main / mini / rest 页分别对应各自入口） */
    setWindowLabel(label) {
      global.__TAURI_INTERNALS__.metadata = {
        currentWindow: { label },
        currentWebview: { windowLabel: label, label },
      };
    },

    /**
     * 重新挂载前端应用：先正式卸载旧应用，再重新执行入口。
     * 动态 import 带查询参数是为了绕开模块缓存——同一个 URL 的 import 只执行一次。
     * 直接往已有旧应用的容器上 mount，Vue 会把旧树当 prevVNode 去 patch，
     * 旧树残缺时直接崩，所以先卸载并清容器。
     * 只能在浏览器里用。
     */
    async remount(entry = "/src/windows/main/main.ts") {
      if (typeof document === "undefined") {
        throw new Error("[browser-harness] remount 只能在浏览器里用");
      }
      const root = document.querySelector("#app");
      if (root) {
        // 上次挂载如果中途崩过，unmount 可能再抛；这里的目的是清场，尽力而为
        try {
          root.__vue_app__?.unmount();
        } catch (e) {
          console.warn("[browser-harness] 旧应用卸载异常（忽略）:", e?.message ?? e);
        }
        root._vnode = null;
        root.innerHTML = "";
      }
      await import(`${entry}?harness=${Date.now()}`);
    },
  };

  global.__HARNESS__ = HARNESS;
})(globalThis);
