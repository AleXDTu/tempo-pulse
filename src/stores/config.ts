import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, PulseState, Schedule, Settings } from "../lib/types";
import { onConfigChanged } from "../lib/events";
import { applyTheme } from "../lib/theme";

/**
 * 配置 store。主窗编辑后调用 save*，由 Rust 持久化并广播
 * config-changed，全部窗口（含主窗自身）以广播为准刷新，保证单一数据源。
 */
export const useConfigStore = defineStore("config", () => {
  const config = ref<AppConfig | null>(null);
  const inited = ref(false);

  async function init() {
    if (inited.value) return;
    inited.value = true;
    config.value = await invoke<AppConfig>("get_config");
    applyTheme(config.value.settings.theme);
    await onConfigChanged((c) => {
      config.value = c;
      applyTheme(c.settings.theme);
    });
  }

  async function saveStates(states: PulseState[]) {
    await invoke("save_states", { states });
  }

  async function saveSchedules(schedules: Schedule[]) {
    await invoke("save_schedules", { schedules });
  }

  async function saveSettings(settings: Settings) {
    await invoke("save_settings", { settings });
  }

  async function setMiniVisible(visible: boolean) {
    await invoke("set_mini_visible", { visible });
  }

  /** 保存休息屏背景图片（dataURL），返回资产绝对路径 */
  async function saveRestBgImage(dataUrl: string): Promise<string> {
    return await invoke<string>("save_rest_bg_image", { dataUrl });
  }

  const states = computed(() => config.value?.states ?? []);
  const schedules = computed(() => config.value?.schedules ?? []);
  const settings = computed(() => config.value?.settings);
  const stateById = computed(() => {
    const map = new Map<string, PulseState>();
    for (const s of states.value) map.set(s.id, s);
    return (id: string | null | undefined) =>
      id ? (map.get(id) ?? null) : null;
  });

  return {
    config,
    init,
    saveStates,
    saveSchedules,
    saveSettings,
    setMiniVisible,
    saveRestBgImage,
    states,
    schedules,
    settings,
    stateById,
  };
});
