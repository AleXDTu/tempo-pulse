import type { StateKind, TimeBlock } from "./types";

/** 分钟数 → "HH:MM" */
export function fmt(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function block(start: number, end: number, stateId: string, note: string | null = null): TimeBlock {
  return { id: crypto.randomUUID(), start: fmt(start), end: fmt(end), stateId, note };
}

/**
 * 在 [start, end) 内生成 专注+小憩 循环；收尾不足一个循环时并入最后一个专注块。
 */
export function cycles(
  start: number,
  end: number,
  focusMin: number,
  breakMin: number,
  focusId: string,
  slackId: string,
): TimeBlock[] {
  const blocks: TimeBlock[] = [];
  let t = start;
  while (t < end) {
    const fEnd = Math.min(t + focusMin, end);
    blocks.push(block(t, fEnd, focusId));
    t = fEnd;
    if (end - t >= breakMin) {
      blocks.push(block(t, t + breakMin, slackId));
      t += breakMin;
    }
  }
  const last = blocks[blocks.length - 1];
  if (last && last.stateId === focusId && last.end !== fmt(end)) last.end = fmt(end);
  return blocks;
}

export interface RhythmTemplate {
  key: string;
  name: string;
  desc: string;
  focusMin: number;
  breakMin: number;
}

/** 内置节奏模板：一天 9:00-18:00，含午休 12:00-13:30 */
export const RHYTHM_TEMPLATES: RhythmTemplate[] = [
  { key: "balanced", name: "劳逸结合", desc: "55 分钟专注 + 5 分钟小憩", focusMin: 55, breakMin: 5 },
  { key: "deep", name: "深度工作", desc: "90 分钟专注 + 15 分钟休息", focusMin: 90, breakMin: 15 },
  { key: "pomodoro", name: "番茄钟", desc: "25 分钟专注 + 5 分钟小憩", focusMin: 25, breakMin: 5 },
];

/** 按模板生成工作日整天块（9:00-12:00 与 13:30-18:00 两段，午休 12:00-13:30） */
export function buildDayBlocks(
  tpl: RhythmTemplate,
  ids: { focus: string; slack: string; rest: string },
): TimeBlock[] {
  return [
    ...cycles(540, 720, tpl.focusMin, tpl.breakMin, ids.focus, ids.slack),
    block(720, 810, ids.rest, "午休"),
    ...cycles(810, 1080, tpl.focusMin, tpl.breakMin, ids.focus, ids.slack),
  ];
}

/** 从状态列表取某 kind 的默认状态 id，找不到则回退第一个状态 */
export function stateIdByKind(states: { id: string; kind: StateKind }[], kind: StateKind): string {
  return states.find((s) => s.kind === kind)?.id ?? states[0]?.id ?? "";
}
