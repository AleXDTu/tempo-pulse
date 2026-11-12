import { createApp } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { PulseState, StateEffectType } from "./types";
import FinaleOverlay from "../components/effects/FinaleOverlay.vue";

/** 播放上下文：播放器只认这个接口，不直接依赖 App 结构 */
export interface EffectContext {
  /** Tauri invoke：震动等窗口物理操作走命令 */
  invoke: typeof invoke;
  /** 触发特效的状态，emoji / 颜色给特效取材 */
  state: PulseState;
  /** 特效层挂载点（主窗内全窗覆盖的容器，见 App.vue） */
  mount: HTMLElement;
}

export interface EffectDef {
  /** 配置 UI 里的选项文案 */
  label: string;
  /** 完整播放一次特效；结束（或被点击跳过）后 resolve */
  play(ctx: EffectContext): Promise<void>;
}

/** 震动第一版固定档：约半秒、6 物理像素（不做特效参数编辑器） */
const SHAKE_DURATION_MS = 600;
const SHAKE_AMPLITUDE_PX = 6;

/** 窗口震动：Rust 侧 set_position 正弦衰减抖动后复位，命令返回时已复位 */
async function playShake(ctx: EffectContext) {
  await ctx.invoke("shake_main_window", {
    durationMs: SHAKE_DURATION_MS,
    amplitude: SHAKE_AMPLITUDE_PX,
  });
}

/** 结算画面：往特效层挂载 FinaleOverlay，动画结束或点击跳过后卸载 */
function playFinale(ctx: EffectContext): Promise<void> {
  return new Promise((resolve) => {
    const app = createApp(FinaleOverlay, {
      state: ctx.state,
      onDone: () => {
        app.unmount();
        resolve();
      },
    });
    app.mount(ctx.mount);
  });
}

/**
 * 特效注册表：新增一种特效 = types.ts 加枚举值 + 这里注册一个播放器，
 * 配置 UI 的选项从注册表渲染（StatesView 不硬编码选项）。
 */
export const EFFECT_DEFS: Record<StateEffectType, EffectDef> = {
  shake: { label: "窗口震动", play: playShake },
  finale: { label: "结算画面", play: playFinale },
};

/** 配置 UI 渲染选项用：注册表按定义顺序展开 */
export const EFFECT_ENTRIES: { key: StateEffectType; def: EffectDef }[] =
  Object.entries(EFFECT_DEFS).map(([key, def]) => ({
    key: key as StateEffectType,
    def,
  }));

/** 依次播放一串特效；注册表里不存在的名字直接跳过（手改配置的笔误不该让播放崩溃） */
export async function playEffects(
  names: readonly string[],
  ctx: EffectContext,
): Promise<void> {
  for (const name of names) {
    const def = EFFECT_DEFS[name as StateEffectType];
    if (def) await def.play(ctx);
  }
}
