<script setup lang="ts">
import { computed } from "vue";
import type { PulseState, Schedule } from "../lib/types";
import { hhmmToMinutes } from "../lib/format";

const props = defineProps<{
  schedule: Schedule | null;
  stateOf: (id: string) => PulseState | null;
  /** "HH:MM"，空则不画当前时刻线 */
  now?: string | null;
  /** 点击空白时段（分钟数）时触发，未传则只读 */
  onCreateAt?: (startMin: number) => void;
}>();

interface Segment {
  left: number; // %
  width: number; // %
  color: string;
  label: string;
  title: string;
  startMin: number;
  endMin: number;
}

const segments = computed<Segment[]>(() => {
  if (!props.schedule) return [];
  return props.schedule.blocks
    .map((b) => {
      const s = hhmmToMinutes(b.start);
      const e = hhmmToMinutes(b.end);
      if (s === null || e === null || e <= s) return null;
      const st = props.stateOf(b.stateId);
      const color = st?.color ?? "#928374";
      return {
        left: (s / 1440) * 100,
        width: ((e - s) / 1440) * 100,
        color,
        label: st?.emoji ?? "",
        title: `${b.start}-${b.end} ${st?.label ?? "?"}${b.note ? " · " + b.note : ""}`,
        startMin: s,
        endMin: e,
      } satisfies Segment;
    })
    .filter((x): x is Segment => x !== null)
    .sort((a, b) => a.left - b.left);
});

const nowLeft = computed(() => {
  const m = props.now ? hhmmToMinutes(props.now) : null;
  return m === null ? null : (m / 1440) * 100;
});

const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** 点击时间条：命中已有块不动作；点在空隙 → 以空隙起点（不早于当前时刻线之后无限制）建块 */
function onClick(e: MouseEvent) {
  if (!props.onCreateAt) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 0.9999);
  const clicked = Math.floor(ratio * 1440);

  // 命中已有块 → 忽略（编辑请用列表）
  const hit = segments.value.find((s) => clicked >= s.startMin && clicked < s.endMin);
  if (hit) return;

  // 空隙起点：取点击位置；若与后一块的 start 落在同一格，钳到后一块 start 之前
  let start = Math.floor(clicked / 15) * 15; // 15 分钟对齐
  const nextSeg = segments.value
    .filter((s) => s.startMin > start)
    .sort((a, b) => a.startMin - b.startMin)[0];
  if (nextSeg && start > nextSeg.startMin - 15) start = nextSeg.startMin - 15;
  if (start < 0) start = 0;
  props.onCreateAt(start);
}
</script>

<template>
  <div class="w-full select-none">
    <div
      class="relative h-9 w-full overflow-hidden rounded-lg bg-base-deep ring-1 ring-line"
      :class="props.onCreateAt ? 'cursor-copy' : ''"
      :title="props.onCreateAt ? '点击空白时段可快速添加时间块' : undefined"
      @click="onClick"
    >
      <div
        v-for="seg in segments"
        :key="seg.title"
        class="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px]"
        :style="{
          left: seg.left + '%',
          width: seg.width + '%',
          backgroundColor: seg.color + '30',
          borderLeft: '2px solid ' + seg.color,
        }"
        :title="seg.title"
      >
        <span v-if="seg.width > 4">{{ seg.label }}</span>
      </div>
      <div
        v-if="nowLeft !== null"
        class="absolute inset-y-0 w-0.5 bg-primary/80 shadow-[0_0_6px_rgba(251,241,199,0.8)]"
        :style="{ left: nowLeft + '%' }"
      />
    </div>
    <div class="tnum mt-1 flex justify-between text-[10px] text-tertiary">
      <span v-for="h in hours" :key="h">{{ String(h).padStart(2, "0") }}</span>
    </div>
  </div>
</template>
