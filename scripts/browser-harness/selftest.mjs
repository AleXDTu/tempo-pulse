/**
 * browser-harness 自检：node scripts/browser-harness/selftest.mjs
 *
 * 前提：仓库根目录跑过 pnpm install（后半段要用真实的 @tauri-apps/api，
 * 和页面同一个包，保证模拟层满足它的调用约定）。
 *
 * A 组：node:vm 沙箱里直接驱动模拟层，不需要浏览器和依赖；
 * B 组：把模拟层装到 node 全局，用真实 @tauri-apps/api 的 invoke / listen
 *       再走一遍，覆盖 store 实际使用的代码路径。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const DIR = dirname(fileURLToPath(import.meta.url));
const dataSrc = readFileSync(join(DIR, "mock-data.js"), "utf8");
const ipcSrc = readFileSync(join(DIR, "mock-ipc.js"), "utf8");

/** vm 沙箱里跑两个脚本，返回沙箱全局对象 */
function installInSandbox(extra = {}) {
  const warns = [];
  const sandbox = {
    console: { warn: (...a) => warns.push(a.join(" ")), log() {}, error() {} },
    structuredClone, // vm 新上下文不一定带，显式给一个（浏览器里天然存在）
    ...extra,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(dataSrc, ctx);
  vm.runInContext(ipcSrc, ctx);
  return { sandbox, warns };
}

/** 跨 realm 对象先 JSON 往返再比，避免原型不一致的误报 */
function jsonEqual(got, expected, msg) {
  // 期望值可能来自 vm 沙箱（原型在另一个 realm），两边都 JSON 往返再比
  assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(expected)), msg);
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed + failures.length} - ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`not ok ${passed + failures.length} - ${name}`);
    console.log(`  ${e?.message ?? e}`);
  }
}

async function rejects(promise, msgPart, msg) {
  try {
    await promise;
  } catch (e) {
    assert.ok(String(e.message).includes(msgPart), `报错信息应含「${msgPart}」，实际: ${e.message}`);
    return;
  }
  throw new Error(msg);
}

// ---------- A 组：模拟层直测 ----------

await test("A1 未先注入 mock-data.js 时，mock-ipc.js 直接报错", () => {
  const ctx = vm.createContext({ console: { warn() {}, log() {}, error() {} } });
  assert.throws(() => vm.runInContext(ipcSrc, ctx), /mock-data\.js/);
});

const { sandbox: w, warns } = installInSandbox();
const DATA = w.__HARNESS_MOCK_DATA__;
const DEF = DATA.defaults;

await test("A2 __TAURI_INTERNALS__ 装齐（invoke / transformCallback / 元数据 / convertFileSrc）", () => {
  const I = w.__TAURI_INTERNALS__;
  assert.equal(typeof I.invoke, "function");
  assert.equal(typeof I.transformCallback, "function");
  assert.equal(typeof I.unregisterCallback, "function");
  assert.equal(I.metadata.currentWindow.label, "main");
  assert.match(I.convertFileSrc("/a b.png"), /^asset:\/\/localhost\/%2Fa%20b\.png$/);
  assert.equal(w.isTauri, true);
  assert.equal(typeof w.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener, "function");
});

await test("A3 invoke('get_snapshot') 返回默认快照，now 未补零", async () => {
  const snap = await w.__TAURI_INTERNALS__.invoke("get_snapshot");
  jsonEqual(snap, DEF.snapshot);
  assert.equal(snap.now, "15:7:3");
});

await test("A4 值是深拷贝：页面改返回值不污染命令表", async () => {
  const s = await w.__TAURI_INTERNALS__.invoke("get_snapshot");
  s.remainingSecs = -1;
  s.state.label = "被改坏了";
  const s2 = await w.__TAURI_INTERNALS__.invoke("get_snapshot");
  assert.equal(s2.remainingSecs, DEF.snapshot.remainingSecs);
  assert.equal(s2.state.label, "专注");
});

await test("A5 未配置的命令报错并提示 setCommand", async () => {
  await rejects(
    w.__TAURI_INTERNALS__.invoke("no_such_cmd"),
    "未配置的命令",
    "invoke 未配置的命令应当报错",
  );
});

await test("A6 setCommand 覆盖返回值，reset 恢复默认", async () => {
  const H = w.__HARNESS__;
  H.setCommand("get_snapshot", { ...DEF.snapshot, now: "8:0:0" });
  assert.equal((await w.__TAURI_INTERNALS__.invoke("get_snapshot")).now, "8:0:0");
  H.reset();
  assert.equal((await w.__TAURI_INTERNALS__.invoke("get_snapshot")).now, "15:7:3");
});

await test("A7 命令表配函数时收到 args 并返回其结果", async () => {
  const H = w.__HARNESS__;
  H.setCommand("echo", (args) => ({ got: args }));
  jsonEqual(await w.__TAURI_INTERNALS__.invoke("echo", { a: 1 }), { got: { a: 1 } });
  H.reset();
});

await test("A8 calls 记录每次 invoke，clearCalls 清空", async () => {
  const H = w.__HARNESS__;
  H.clearCalls();
  await w.__TAURI_INTERNALS__.invoke("get_config");
  await w.__TAURI_INTERNALS__.invoke("get_snapshot");
  assert.equal(H.calls.length, 2);
  assert.equal(H.calls[0].cmd, "get_config");
  H.clearCalls();
  assert.equal(H.calls.length, 0);
});

// ---- 事件 ----

async function watchEvent(H, event, collect = []) {
  // 模拟 @tauri-apps/api listen 的完整流程：transformCallback → plugin:event|listen
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => collect.push(e));
  const eventId = await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event,
    target: { kind: "Any" },
    handler: cbId,
  });
  return { cbId, eventId, collect };
}

await test("A9 listen 注册后 emitEvent 回调收到 { event, id, payload }", async () => {
  const H = w.__HARNESS__;
  const { collect } = await watchEvent(H, DATA.events.tick);
  H.emitEvent(DATA.events.tick, { now: "1:2:3" });
  assert.equal(collect.length, 1);
  assert.equal(collect[0].event, DATA.events.tick);
  assert.deepEqual(collect[0].payload, { now: "1:2:3" });
  assert.equal(typeof collect[0].id, "number");
});

await test("A10 pushTick 的 patch 浅合并到默认快照", async () => {
  const H = w.__HARNESS__;
  const { collect } = await watchEvent(H, DATA.events.tick);
  H.pushTick({ now: "17:59:58", remainingSecs: 2 });
  const p = collect[0].payload;
  assert.equal(p.now, "17:59:58");
  assert.equal(p.remainingSecs, 2);
  assert.equal(p.state.label, "专注"); // 没改的字段保留默认值
  assert.equal(p.scheduleName, "工作日节奏");
});

await test("A11 pushTransition 载荷是 { from, to }，to 可打补丁", async () => {
  const H = w.__HARNESS__;
  const { collect } = await watchEvent(H, DATA.events.transition);
  H.pushTransition({ to: { remainingSecs: 5 } });
  const p = collect[0].payload;
  assert.equal(p.from.label, "专注");
  assert.equal(p.to.state.label, "休息");
  assert.equal(p.to.remainingSecs, 5);
});

await test("A12 pushConfigChanged 默认广播完整 config", async () => {
  const H = w.__HARNESS__;
  const { collect } = await watchEvent(H, DATA.events.configChanged);
  H.pushConfigChanged();
  jsonEqual(collect[0].payload, DEF.config);
});

await test("A13 once 回调只触发一次", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e), true);
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.restDismissed,
    handler: cbId,
  });
  H.pushRestDismissed();
  H.pushRestDismissed();
  assert.equal(seen.length, 1);
});

await test("A14 unregisterCallback 后不再回调，并给出 warn", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.tick,
    handler: cbId,
  });
  w.__TAURI_INTERNALS__.unregisterCallback(cbId);
  const before = warns.length;
  H.pushTick();
  assert.equal(seen.length, 0);
  assert.ok(warns.length > before, "注销后的派发应打 warn");
});

await test("A15 plugin:event|unlisten 后不再回调", async () => {
  const H = w.__HARNESS__;
  const event = "t://unlisten"; // 独立事件名，不受前序测试留下的监听器影响
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  const eventId = await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event,
    handler: cbId,
  });
  await w.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event, eventId });
  H.emitEvent(event, { n: 1 });
  assert.equal(seen.length, 0);
  assert.equal(H.listenerCount(event), 0);
});

await test("A16 __TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener 也能注销（2.11.x 会裸调）", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  const eventId = await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.configChanged,
    handler: cbId,
  });
  w.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(DATA.events.configChanged, eventId);
  H.pushConfigChanged();
  assert.equal(seen.length, 0);
});

await test("A17 listeners() 列出各事件的监听器", async () => {
  const H = w.__HARNESS__;
  assert.ok(Array.isArray(H.listeners()[DATA.events.tick]));
  const n = H.listenerCount(DATA.events.tick);
  const cbId = w.__TAURI_INTERNALS__.transformCallback(() => {});
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.tick,
    handler: cbId,
  });
  assert.equal(H.listenerCount(DATA.events.tick), n + 1);
});

await test("A18 前端 emit（plugin:event|emit）扇出到本页监听器", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: "my://custom",
    handler: cbId,
  });
  await w.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
    event: "my://custom",
    payload: 42,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload, 42);
});

// ---- 写命令的广播副作用（对应 commands.rs 的 persist_and_broadcast） ----

await test("A19 set_running(false) 广播清零快照的 tick", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.tick,
    handler: cbId,
  });
  await w.__TAURI_INTERNALS__.invoke("set_running", { running: false });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload.running, false);
  assert.equal(seen[0].payload.state, null);
  assert.equal(seen[0].payload.remainingSecs, 0);
});

await test("A20 skip_current_block 广播静默快照（isIdle=true）", async () => {
  const H = w.__HARNESS__;
  const seen = [];
  const cbId = w.__TAURI_INTERNALS__.transformCallback((e) => seen.push(e));
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.tick,
    handler: cbId,
  });
  await w.__TAURI_INTERNALS__.invoke("skip_current_block");
  assert.equal(seen.at(-1).payload.isIdle, true);
  assert.equal(seen.at(-1).payload.state, null);
});

await test("A21 save_settings 广播合并后的 config-changed + tick", async () => {
  const H = w.__HARNESS__;
  const cfgSeen = [];
  const tickSeen = [];
  const cfgId = w.__TAURI_INTERNALS__.transformCallback((e) => cfgSeen.push(e));
  const tickId = w.__TAURI_INTERNALS__.transformCallback((e) => tickSeen.push(e));
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.configChanged,
    handler: cfgId,
  });
  await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event: DATA.events.tick,
    handler: tickId,
  });
  const settings = { ...DEF.config.settings, theme: "light" };
  await w.__TAURI_INTERNALS__.invoke("save_settings", { settings });
  assert.equal(cfgSeen.length, 1);
  assert.equal(cfgSeen[0].payload.settings.theme, "light");
  assert.equal(cfgSeen[0].payload.states.length, DEF.config.states.length);
  assert.equal(tickSeen.length, 1);
});

await test("A22 remount 在非浏览器环境直接报错（fast-fail）", async () => {
  await rejects(w.__HARNESS__.remount(), "只能在浏览器里用", "沙箱里 remount 应当报错");
});

// ---------- B 组：真实 @tauri-apps/api 走一遍 ----------

// 装到 node 主 realm：@tauri-apps/api 通过 window.__TAURI_INTERNALS__ 寻址
globalThis.window = globalThis;
vm.runInThisContext(dataSrc);
vm.runInThisContext(ipcSrc);

await test("B1 真实 invoke('get_snapshot') 拿到默认快照", async () => {
  const snap = await invoke("get_snapshot");
  jsonEqual(snap, globalThis.__HARNESS_MOCK_DATA__.defaults.snapshot);
});

await test("B2 真实 listen 收到 pushTick，unlisten 后不再收到", async () => {
  const seen = [];
  const unlisten = await listen("pulse://tick", (e) => seen.push(e.payload));
  assert.equal(globalThis.__HARNESS__.listenerCount("pulse://tick"), 1);
  globalThis.__HARNESS__.pushTick({ now: "23:59:58", remainingSecs: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].now, "23:59:58");
  await unlisten();
  assert.equal(globalThis.__HARNESS__.listenerCount("pulse://tick"), 0);
  globalThis.__HARNESS__.pushTick({ now: "0:0:1" });
  assert.equal(seen.length, 1);
});

await test("B3 真实 invoke 未配置命令时按 Promise 拒绝", async () => {
  await rejects(invoke("definitely_not_a_command"), "未配置的命令", "真实 invoke 应当拒绝");
});

// ---------- 汇总 ----------

const total = passed + failures.length;
console.log(`\n${passed}/${total} 项通过${failures.length === 0 ? "，全绿" : "，有失败项"}`);
if (failures.length > 0) process.exitCode = 1;
