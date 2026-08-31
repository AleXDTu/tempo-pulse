<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { usePulseStore } from "../../stores/pulse";
import { useConfigStore } from "../../stores/config";
import ScheduleView from "./ScheduleView.vue";
import StatesView from "./StatesView.vue";
import SettingsView from "./SettingsView.vue";
import Onboarding from "./Onboarding.vue";
import { formatCountdown } from "../../lib/format";

const pulse = usePulseStore();
const config = useConfigStore();
const tab = ref<"schedule" | "states" | "settings">("schedule");

onMounted(async () => {
  await Promise.all([pulse.init(), config.init()]);
});

const tabs = [
  { key: "schedule", label: "时间表" },
  { key: "states", label: "状态" },
  { key: "settings", label: "设置" },
] as const;

const running = computed(() => pulse.running);
/** 停止时整体置灰 */
const heroColor = computed(() => (running.value ? pulse.color : "#64748b"));
const heroEmoji = computed(() => (running.value ? pulse.emoji : "⏸"));
const heroLabel = computed(() => (running.value ? pulse.label : "已停止"));
const remaining = computed(() =>
  running.value && pulse.snapshot
    ? formatCountdown(pulse.snapshot.remainingSecs)
    : "--:--",
);
const remainingHint = computed(() =>
  !running.value ? "总开关已停止" : pulse.isIdle ? "距离下一段" : "剩余时间",
);
const nextHint = computed(() => {
  if (!running.value) return "开始后按时间表自动切换 · 停止期间不计时、不提醒";
  const s = pulse.snapshot;
  if (!s) return "";
  if (s.isIdle) {
    return s.nextAt
      ? `${s.nextAt} 进入「${s.nextStateLabel ?? "下一站"}」`
      : "今天没有安排了，享受自由";
  }
  const next = s.nextAt ? `直到 ${s.nextAt}` : "";
  const then = s.nextStateLabel ? ` · 然后「${s.nextStateLabel}」` : "";
  return next + then;
});

async function toggleRun() {
  await pulse.setRunning(!running.value);
}
</script>

<template>
  <div
    class="relative flex h-full flex-col bg-slate-950 bg-[radial-gradient(1200px_600px_at_80%_-10%,rgba(56,189,248,0.08),transparent)] text-slate-200"
  >
    <!-- 顶部：当前节奏 -->
    <header
      :key="running ? (pulse.snapshot?.blockId ?? 'idle') : 'stopped'"
      class="pulse-hero mx-5 mt-5 flex items-center justify-between rounded-2xl border bg-white/[0.03] px-6 py-5"
      :style="{
        borderColor: heroColor + '40',
        boxShadow: `0 0 24px ${heroColor}14 inset`,
      }"
    >
      <div class="flex items-center gap-4">
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
          :style="{ backgroundColor: heroColor + '22' }"
        >
          {{ heroEmoji }}
        </div>
        <div>
          <div class="flex items-baseline gap-2">
            <span class="text-xl font-semibold" :style="{ color: heroColor }">
              {{ heroLabel }}
            </span>
            <span
              v-if="running && pulse.snapshot?.scheduleName"
              class="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400"
            >
              {{ pulse.snapshot.scheduleName }}
            </span>
          </div>
          <div class="mt-1 text-sm text-slate-400">
            {{ nextHint }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <div class="text-right">
          <div class="tnum text-4xl font-bold tracking-tight">
            {{ remaining }}
          </div>
          <div class="text-xs text-slate-500">{{ remainingHint }}</div>
        </div>
        <button
          v-if="running && !pulse.isIdle"
          class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
          title="本块剩余时间静默，下一块照常"
          @click="pulse.skipCurrentBlock()"
        >
          跳过此段
        </button>
        <button
          v-if="running"
          class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/10"
          @click="toggleRun"
        >
          ⏸ 停止
        </button>
        <button
          v-else
          class="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
          @click="toggleRun"
        >
          ▶ 开始节奏
        </button>
      </div>
    </header>

    <!-- Tabs -->
    <nav class="mx-5 mt-4 flex gap-1 rounded-xl bg-white/[0.04] p-1 text-sm">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="flex-1 rounded-lg px-4 py-2 transition"
        :class="
          tab === t.key
            ? 'bg-white/10 font-medium text-white'
            : 'text-slate-400 hover:text-slate-200'
        "
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- 内容区 -->
    <main class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <ScheduleView v-if="tab === 'schedule'" />
      <StatesView v-else-if="tab === 'states'" />
      <SettingsView v-else />
    </main>

    <!-- 首次启动引导 -->
    <Onboarding v-if="config.settings && !config.settings.onboarded" />
  </div>
</template>

<style scoped>
.pulse-hero {
  animation: hero-in 0.45s ease-out;
}
@keyframes hero-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
