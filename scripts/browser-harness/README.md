# browser-harness：普通浏览器里驱动 Tauri 前端

在 Chrome 里跑 tempo-pulse 的页面（不起 Rust 进程）：往页面注入一层
Tauri IPC 模拟，`invoke` 走本地假数据、`listen` 收本地推送的事件，
Vue 页面照常渲染，再用脚本喂数据驱动它。开发会话验证页面行为、
测试人员复现问题时都用这一套，不用每次从零摸索。

不进构建流程、不改 vite 配置：文件都在 `scripts/browser-harness/`，
由 vite 开发服务器按静态文件直接对外提供。

## 文件

| 文件 | 作用 |
| --- | --- |
| `mock-data.js` | 命令清单和默认返回值（字段和 `src/lib/types.ts` 一一对应）。后端加命令只改这里 |
| `mock-ipc.js` | 安装 `window.__TAURI_INTERNALS__`（invoke / transformCallback / 事件系统）和对外控制面 `window.__HARNESS__` |
| `fixtures/snapshot.json` | 一份现成快照（now 不补零，验补零逻辑） |
| `fixtures/transition.json` | 一份现成 transition（专注 → 休息） |
| `fixtures/config.json` | 一份完整 config（4 状态 / 2 时间表 / 浅色主题） |
| `selftest.mjs` | 自检脚本，node 直接跑，不需要浏览器 |

## 1. 起开发服务器

```bash
pnpm install          # 首次需要
pnpm dev --port 5199 --strictPort
```

端口自己挑一个没被占的（`vite.config.ts` 里配置的 1420 是给 `tauri dev` 用的，
浏览器验证换一个，免得和真窗口打架）。localStorage 按端口隔离，
多个会话各用各的端口互不影响。

## 2. 打开页面并注入

用 Chrome DevTools 的 evaluate_script（或控制台）在页面上执行：

```js
const src = (p) => fetch(p).then((r) => r.text());
eval(await src("/scripts/browser-harness/mock-data.js"));
eval(await src("/scripts/browser-harness/mock-ipc.js"));
await window.__HARNESS__.remount();
```

三行各自的事：

1. `mock-data.js` 先装：它只是把命令表放到 `__HARNESS_MOCK_DATA__` 上，
   顺序反了 `mock-ipc.js` 会直接报错提示。
2. `mock-ipc.js` 装 `__TAURI_INTERNALS__`（重复注入时后一次覆盖前一次）。
3. `remount()` 重新挂载应用，见下。

注入必须赶在应用初始化之后补救：页面第一次加载时 `__TAURI_INTERNALS__`
还不存在，store 的 `init()` 会失败，所以注入完要重新挂载一次。

## 3. 重新挂载（remount）

store 的 `init()` 只跑一次（`inited` 标记），装完模拟层必须让应用重新走一遍：

```js
await window.__HARNESS__.remount();               // 主窗（默认）
await window.__HARNESS__.remount("/src/windows/mini/mini.ts");   // 迷你窗页面 /mini.html
await window.__HARNESS__.remount("/src/windows/rest/rest.ts");   // 休息屏页面 /rest.html
await window.__HARNESS__.remount("/src/windows/game/game.ts");   // 游戏窗页面 /game.html
```

原理：remount 先把旧应用正式卸载（容器的 `__vue_app__.unmount()`）并清空
`#app`，再动态 import 入口；入口 URL 带时间戳查询参数，绕开 vite 的模块
缓存（同一个 URL 只执行一次），应用带着新的 pinia 实例重新
`mount("#app")`。不先卸载的话，新应用 mount 时会把旧树当 prevVNode 去
patch，旧树残缺时直接崩。

## 4. 喂数据

```js
// 推一条 tick：patch 浅合并到默认快照，只写想改的字段
__HARNESS__.pushTick({ now: "17:59:58", remainingSecs: 3 });

// 推一条 transition（专注 → 休息，页面会闪一下并切状态）
__HARNESS__.pushTransition({ to: { remainingSecs: 30 * 60 } });

// 广播整份新 config（主题会跟着切）
__HARNESS__.pushConfigChanged();

// 休息屏被引擎关闭的广播
__HARNESS__.pushRestDismissed();

// 任意自定义事件也行
__HARNESS__.emitEvent("pulse://tick", { ...任何完整快照 });
```

换命令的返回值（影响下次 `invoke`，比如重挂载后的初始状态）：

```js
const snap = await (await fetch("/scripts/browser-harness/fixtures/snapshot.json")).json();
__HARNESS__.setCommand("get_snapshot", snap);   // 值直接返回；配函数则收 args
await __HARNESS__.remount();                    // 重挂载后页面按新快照初始化
```

点击页面上的按钮同样会走到模拟层：`set_running` / `skip_current_block` /
`save_settings` 等写命令按 Rust 侧 `persist_and_broadcast` 的语义，
写完广播一条 config-changed 或 tick，界面会自己更新（数据不真正落盘）。

## 5. 断言页面行为

```js
__HARNESS__.calls                      // 每次 invoke 的记录 [{ cmd, args }]
__HARNESS__.calls.filter((c) => c.cmd === "set_running")
__HARNESS__.clearCalls()
__HARNESS__.listeners()                // { 事件名: [回调 id...] }
__HARNESS__.listenerCount("pulse://tick")
```

## 6. 完整最小示例（从开页面到看到假数据）

```bash
pnpm dev --port 5199 --strictPort
```

浏览器开 `http://localhost:5199/`，evaluate_script 执行：

```js
const src = (p) => fetch(p).then((r) => r.text());
eval(await src("/scripts/browser-harness/mock-data.js"));
eval(await src("/scripts/browser-harness/mock-ipc.js"));
await window.__HARNESS__.remount();
```

再执行：

```js
__HARNESS__.pushTick({ now: "17:59:58", remainingSecs: 3 });
```

预期：顶栏时钟显示 `17:59`（引擎给的 `17:59:58` 不补零，store 的
`normalizeEngineClock` 补零后按「时:分」展示），提示行变
「剩余 0 分钟 · 直到 11:30 · 然后「休息」」。主窗顶栏没有秒针和倒计时，
倒计时在迷你窗上（开 `/mini.html`，注入后
`remount("/src/windows/mini/mini.ts")`，再
`pushTick({ remainingSecs: 123 })`，悬浮窗会显示 `02:03`）。
再推一条 transition：

```js
__HARNESS__.pushTransition({ to: { remainingSecs: 30 * 60 } });
```

预期：状态从「专注」切到「休息」，提示行变「剩余 30 分钟」。

## 7. 自检（不用浏览器）

```bash
node scripts/browser-harness/selftest.mjs
```

25 项断言：模拟层直测（invoke 返回与深拷贝、事件注册 / 触发 / 注销、
写命令的广播副作用）＋ 用真实的 `@tauri-apps/api` 把 `invoke` / `listen`
完整走一遍。需要先 `pnpm install`（B 组用 node_modules 里的官方包）。

## 8. 已知边界

- 写操作只广播、不落盘，刷新页面回到默认假数据（对验证够用）。
- `save_rest_bg_image` 返回一个不存在的路径，休息屏背景图选「图片」时
  图片会裂（`convertFileSrc` 指向 `asset://localhost/...`），不会崩。
- `getVersion` 显示 `0.0.0-harness`（设置页版本号）。
- 注入是页面级的：刷新或换页面后要重新执行第 2 步。

## 9. 命令与事件参考

命令默认返回值见 `mock-data.js`（和 `src-tauri/src/lib.rs` 的
`invoke_handler` 清单对齐，另有 `plugin:notification|*`、`plugin:app|version`
两个插件命令）。事件名与 `src/lib/events.ts` 的 `EV` 一致：
`pulse://tick`、`pulse://transition`、`pulse://config-changed`、`pulse://rest-dismissed`。
