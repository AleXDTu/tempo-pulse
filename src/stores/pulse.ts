import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { PulseSnapshot, TransitionPayload } from "../lib/types";
import { onTick, onTransition } from "../lib/events";
import { formatCountdown } from "../lib/format";

/**
 * 节奏快照 store：数据源是 Rust 引擎，窗口只订阅不持有。
 * init() 由各窗口入口调用一次。
 */
export const usePulseStore = defineStore("pulse", () => {
  const snapshot = ref<PulseSnapshot | null>(null);
  /** 最近一次切换，用于窗口做闪烁动画 */
  const lastTransition = ref<TransitionPayload | null>(null);
  const inited = ref(false);

  async function init() {
    if (inited.value) return;
    inited.value = true;
    snapshot.value = await invoke<PulseSnapshot>("get_snapshot");
    await onTick((s) => {
      snapshot.value = s;
    });
    await onTransition((t) => {
      lastTransition.value = t;
      snapshot.value = t.to;
    });
  }

  async function skipCurrentBlock() {
    await invoke("skip_current_block");
  }

  async function setRunning(running: boolean) {
    await invoke("set_running", { running });
  }

  const running = computed(() => snapshot.value?.running ?? false);
  const state = computed(() => snapshot.value?.state ?? null);
  const color = computed(() => state.value?.color ?? "#64748b");
  const countdownText = computed(() =>
    snapshot.value ? formatCountdown(snapshot.value.remainingSecs) : "--:--",
  );
  const isIdle = computed(() => snapshot.value?.isIdle ?? true);
  const label = computed(() => state.value?.label ?? "自由时间");
  const emoji = computed(() => state.value?.emoji ?? "🌙");

  return {
    snapshot,
    lastTransition,
    init,
    skipCurrentBlock,
    setRunning,
    running,
    state,
    color,
    countdownText,
    isIdle,
    label,
    emoji,
  };
});
