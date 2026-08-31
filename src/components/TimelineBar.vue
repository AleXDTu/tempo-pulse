<script setup lang="ts">
import { computed } from "vue";
import type { PulseState, Schedule } from "../lib/types";
import { hhmmToMinutes } from "../lib/format";

const props = defineProps<{
  schedule: Schedule | null;
  stateOf: (id: string) => PulseState | null;
  /** "HH:MM"，空则不画当前时刻线 */
  now?: string | null;
}>();

interface Segment {
  left: number; // %
  width: number; // %
  color: string;
  label: string;
  title: string;
}

const segments = computed<Segment[]>(() => {
  if (!props.schedule) return [];
  return props.schedule.blocks
    .map((b) => {
      const s = hhmmToMinutes(b.start);
      const e = hhmmToMinutes(b.end);
      if (s === null || e === null || e <= s) return null;
      const st = props.stateOf(b.stateId);
      const color = st?.color ?? "#64748b";
      return {
        left: (s / 1440) * 100,
        width: ((e - s) / 1440) * 100,
        color,
        label: st?.emoji ?? "",
        title: `${b.start}-${b.end} ${st?.label ?? "?"}${b.note ? " · " + b.note : ""}`,
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
</script>

<template>
  <div class="w-full select-none">
    <div
      class="relative h-9 w-full overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10"
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
        class="absolute inset-y-0 w-0.5 bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
        :style="{ left: nowLeft + '%' }"
      />
    </div>
    <div class="mt-1 flex justify-between text-[10px] text-slate-500 tnum">
      <span v-for="h in hours" :key="h">{{ String(h).padStart(2, "0") }}</span>
    </div>
  </div>
</template>
