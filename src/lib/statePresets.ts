import type { PulseState, StateKind } from "./types";

/**
 * 状态模板库：按行为类型分组的预设，色相取 gruvbox 系。
 * 点击即插入可编辑行，名称/表情/颜色均可再改。
 */
export interface StatePreset {
  label: string;
  emoji: string;
  color: string;
  kind: StateKind;
}

export const STATE_PRESETS: StatePreset[] = [
  // 专注类：进入提醒，正常节奏
  { label: "深度工作", emoji: "🧠", color: "#fe8019", kind: "focus" },
  { label: "认真工作", emoji: "💪", color: "#d65d0e", kind: "focus" },
  { label: "学习充电", emoji: "📚", color: "#fabd2f", kind: "focus" },
  { label: "全力冲刺", emoji: "🚀", color: "#cc241d", kind: "focus" },
  // 摸鱼类：轻松段，不强制休息
  { label: "摸鱼", emoji: "🐟", color: "#83a598", kind: "slack" },
  { label: "刷手机", emoji: "📱", color: "#d3869b", kind: "slack" },
  { label: "茶水闲聊", emoji: "💬", color: "#458588", kind: "slack" },
  { label: "带薪喝水", emoji: "🥤", color: "#928374", kind: "slack" },
  // 休息类：触发休息屏
  { label: "休息", emoji: "☕", color: "#8ec07c", kind: "rest" },
  { label: "午休", emoji: "😴", color: "#689d6a", kind: "rest" },
  { label: "散步放松", emoji: "🚶", color: "#b8bb26", kind: "rest" },
  { label: "护眼休息", emoji: "👀", color: "#98971a", kind: "rest" },
  // 自定义类：仅提醒，无特殊行为
  { label: "会议协作", emoji: "🤝", color: "#d3869b", kind: "custom" },
  { label: "运动健身", emoji: "🏋️", color: "#fabd2f", kind: "custom" },
  { label: "通勤路上", emoji: "🚇", color: "#83a598", kind: "custom" },
  { label: "家务采购", emoji: "🧹", color: "#a89984", kind: "custom" },
];

export const KIND_LABELS: Record<StateKind, string> = {
  focus: "专注",
  slack: "摸鱼",
  rest: "休息",
  custom: "自定义",
};

export function presetToState(preset: StatePreset): PulseState {
  return {
    id: crypto.randomUUID(),
    label: preset.label,
    emoji: preset.emoji,
    color: preset.color,
    kind: preset.kind,
  };
}
