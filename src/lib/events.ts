import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppConfig, PulseSnapshot, TransitionPayload } from "./types";

/** Rust → JS 事件名统一在此定义 */
export const EV = {
  tick: "pulse://tick",
  transition: "pulse://transition",
  configChanged: "pulse://config-changed",
  restDismissed: "pulse://rest-dismissed",
} as const;

export function onTick(cb: (s: PulseSnapshot) => void): Promise<UnlistenFn> {
  return listen<PulseSnapshot>(EV.tick, (e) => cb(e.payload));
}

export function onTransition(
  cb: (t: TransitionPayload) => void,
): Promise<UnlistenFn> {
  return listen<TransitionPayload>(EV.transition, (e) => cb(e.payload));
}

export function onConfigChanged(
  cb: (c: AppConfig) => void,
): Promise<UnlistenFn> {
  return listen<AppConfig>(EV.configChanged, (e) => cb(e.payload));
}

/** 休息屏被引擎主动关闭（休息结束）时通知前端做收尾动画 */
export function onRestDismissed(cb: () => void): Promise<UnlistenFn> {
  return listen<void>(EV.restDismissed, () => cb());
}
