<script setup lang="ts">
import { ref } from "vue";
import { useConfigStore } from "../../stores/config";
import type { PulseState, Schedule, TimeBlock } from "../../lib/types";

/**
 * 首次启动引导：欢迎 → 确认状态 → 选节奏预设 → 完成并开始。
 * 随时可跳过；跳过后保持停止，不打扰用户自己探索。
 */
const config = useConfigStore();

const step = ref(1);
const total = 3;
const preset = ref<"balanced" | "deep" | "blank">("balanced");
const busy = ref(false);

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmt(m: number) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
function block(start: number, end: number, stateId: string, note: string | null = null): TimeBlock {
  return { id: crypto.randomUUID(), start: fmt(start), end: fmt(end), stateId, note };
}

/** 在 [start, end) 内生成 专注+小憩 循环；收尾不足一个循环时并入最后一个专注块 */
function cycles(
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

function stateId(kind: PulseState["kind"]): string {
  return config.states.find((s) => s.kind === kind)?.id ?? "";
}

function buildSchedules(): Schedule[] {
  const f = stateId("focus");
  const s = stateId("slack");
  const r = stateId("rest");
  let blocks: TimeBlock[] = [];
  if (preset.value === "balanced") {
    blocks = [
      ...cycles(540, 720, 55, 5, f, s),
      block(720, 810, r, "午休"),
      ...cycles(810, 1080, 55, 5, f, s),
    ];
  } else if (preset.value === "deep") {
    blocks = [
      ...cycles(540, 720, 90, 15, f, s),
      block(720, 810, r, "午休"),
      ...cycles(810, 1080, 90, 15, f, s),
    ];
  }
  return [
    { id: crypto.randomUUID(), name: "工作日节奏", blocks, activeDays: [1, 2, 3, 4, 5] },
    { id: crypto.randomUUID(), name: "周末节奏", blocks: [], activeDays: [6, 7] },
  ];
}

async function finish() {
  busy.value = true;
  try {
    const st = config.settings!;
    if (preset.value !== "blank") {
      await config.saveSchedules(buildSchedules());
    }
    await config.saveSettings({ ...st, onboarded: true, running: preset.value !== "blank" });
  } finally {
    busy.value = false;
  }
}

async function skip() {
  busy.value = true;
  try {
    const st = config.settings!;
    // 跳过引导：完成引导但不开始，保持停止态
    await config.saveSettings({ ...st, onboarded: true, running: false });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    v-if="config.settings"
    class="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-8 backdrop-blur-sm"
  >
    <div
      class="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl"
    >
      <!-- 进度点 -->
      <div class="mb-6 flex items-center justify-center gap-2">
        <span
          v-for="i in total"
          :key="i"
          class="h-1.5 rounded-full transition-all"
          :class="i === step ? 'w-6 bg-sky-400' : i < step ? 'w-1.5 bg-sky-400/50' : 'w-1.5 bg-white/15'"
        />
      </div>

      <!-- Step 1 欢迎 -->
      <div v-if="step === 1" class="text-center">
        <div class="text-5xl">⏱️</div>
        <h2 class="mt-4 text-2xl font-bold">欢迎使用 Tempo Pulse</h2>
        <p class="mt-3 text-sm leading-relaxed text-slate-400">
          你的时间节奏，由你自己定义。
          把一天切成一段段时间块，每段绑定一个状态——
          什么时间认真工作、什么时间摸鱼、什么时间强制休息，全部说了算。
        </p>
        <ul class="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-slate-300">
          <li class="flex items-center gap-2">
            <span class="text-emerald-400">●</span> 迷你悬浮窗常驻显示倒计时
          </li>
          <li class="flex items-center gap-2">
            <span class="text-sky-400">●</span> 到点切换状态并发通知
          </li>
          <li class="flex items-center gap-2">
            <span class="text-orange-400">●</span> 休息时段自动弹出休息屏
          </li>
        </ul>
      </div>

      <!-- Step 2 状态 -->
      <div v-else-if="step === 2" class="text-center">
        <h2 class="text-2xl font-bold">先认识一下「状态」</h2>
        <p class="mt-3 text-sm text-slate-400">
          时间块绑定状态，状态决定颜色、提醒和是否触发休息屏。
          已为你准备了三个常用的，随时可在「状态」页增删改。
        </p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <div
            v-for="s in config.states"
            :key="s.id"
            class="flex items-center gap-2 rounded-2xl border px-4 py-3"
            :style="{ borderColor: s.color + '55', backgroundColor: s.color + '14' }"
          >
            <span class="text-2xl">{{ s.emoji }}</span>
            <span class="font-medium" :style="{ color: s.color }">{{ s.label }}</span>
          </div>
        </div>
        <p class="mt-5 text-xs text-slate-500">
          「休息」类型的状态会触发全屏/小窗休息提醒
        </p>
      </div>

      <!-- Step 3 节奏预设 -->
      <div v-else class="text-center">
        <h2 class="text-2xl font-bold">选一个工作日节奏</h2>
        <p class="mt-3 text-sm text-slate-400">
          生成周一到周五的时间表，之后随时可精细调整
        </p>
        <div class="mt-5 space-y-2 text-left">
          <label
            v-for="p in [
              { key: 'balanced', title: '劳逸结合', desc: '55 分钟专注 + 5 分钟小憩 · 12:00-13:30 午休 · 9:00-18:00' },
              { key: 'deep', title: '深度工作', desc: '90 分钟专注 + 15 分钟休息 · 12:00-13:30 午休 · 9:00-18:00' },
              { key: 'blank', title: '空白时间表', desc: '跳过预设，稍后在「时间表」页自己搭' },
            ]"
            :key="p.key"
            class="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition"
            :class="
              preset === p.key
                ? 'border-sky-400/50 bg-sky-400/10'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
            "
          >
            <input
              v-model="preset"
              type="radio"
              :value="p.key"
              class="mt-1 accent-sky-400"
            />
            <div>
              <div class="text-sm font-medium text-slate-200">{{ p.title }}</div>
              <div class="mt-0.5 text-xs text-slate-500">{{ p.desc }}</div>
            </div>
          </label>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="mt-8 flex items-center justify-between">
        <button
          class="rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:text-slate-300"
          :disabled="busy"
          @click="skip"
        >
          跳过引导
        </button>
        <div class="flex gap-2">
          <button
            v-if="step > 1"
            class="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            @click="step--"
          >
            上一步
          </button>
          <button
            v-if="step < total"
            class="rounded-xl bg-sky-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400"
            @click="step++"
          >
            下一步
          </button>
          <button
            v-else
            class="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 disabled:opacity-50"
            :disabled="busy"
            @click="finish"
          >
            {{ preset === "blank" ? "完成" : "完成并开始 ▶" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
