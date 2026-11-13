<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { usePulseStore } from "../../stores/pulse";
import { useConfigStore } from "../../stores/config";
import { playEffects } from "../../lib/effects";
import type { PulseState } from "../../lib/types";
import ScheduleView from "./ScheduleView.vue";
import StatesView from "./StatesView.vue";
import SettingsView from "./SettingsView.vue";
import Onboarding from "./Onboarding.vue";
import OverlayScroll from "../../components/OverlayScroll.vue";

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
/** 停止时整体置灰（gruvbox 中性灰） */
const heroColor = computed(() => (running.value ? pulse.color : "#928374"));
const heroEmoji = computed(() => (running.value ? pulse.emoji : "⏸"));
const heroLabel = computed(() => (running.value ? pulse.label : "已停止"));

/** 当前时间（引擎本地时钟，跟随系统时区；冒号呼吸 + 小秒针） */
const clock = computed(() => {
  const n = pulse.engineNow;
  if (!n) return { hm: "--:--", ss: "", on: false };
  const [h, m, s] = n.split(":");
  return { hm: `${h}:${m}`, ss: s, on: true };
});
const dateText = computed(() => {
  void pulse.engineNow; // 依赖每秒 tick 触发重算（同机同 TZ，无 UTC 参与）
  const d = new Date();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
});

function humanRemain(secs: number): string {
  const m = Math.round(secs / 60);
  if (m >= 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  return `${Math.max(m, 0)} 分钟`;
}

const hintLine = computed(() => {
  if (!running.value) return "开始后按时间表自动切换 · 停止期间不计时、不提醒";
  const s = pulse.snapshot;
  if (!s) return "";
  if (s.isIdle) {
    return s.nextAt
      ? `${s.nextAt} 进入「${s.nextStateLabel ?? "下一站"}」`
      : "今天没有安排了，享受自由";
  }
  const remain = `剩余 ${humanRemain(s.remainingSecs)}`;
  const until = s.nextAt ? `直到 ${s.nextAt}` : "";
  const then = s.nextStateLabel ? ` · 然后「${s.nextStateLabel}」` : "";
  return `${remain} · ${until}${then}`;
});

async function toggleRun() {
  await pulse.setRunning(!running.value);
}

/** 特效层挂载点：特效播放器（结算画面等）往里挂 DOM，空着时不拦截任何交互 */
const effectLayer = ref<HTMLElement | null>(null);
/** 播放中标志：两次震动并发会让第二次把「震偏的位置」当原点复位，必须挡住 */
let effectPlaying = false;

/** 特效编排：先把主窗带到眼前（只配结算画面这类组合同样会被带出来），再依次播放全部所选特效 */
async function playStateEffects(s: PulseState) {
  const names = s.effects ?? [];
  if (effectPlaying || names.length === 0 || !effectLayer.value) return;
  effectPlaying = true;
  try {
    await invoke("show_main_window");
    await playEffects(names, { invoke, state: s, mount: effectLayer.value });
  } finally {
    effectPlaying = false;
  }
}

// 进入自定义状态块触发特效（块结束不触发）；系统通知由 Rust 照发，两者互不影响。
// from 为 null 说明切换前没有上一个状态块：应用启动首帧、停止后重开的第一帧都是这样，
// 用户不是时间到了才进入该块，不播特效。它和「空闲段结束进入块」（同样 from 为 null，
// 但该播——拍板是特效只在进入该状态块时触发）靠 Rust 侧的 timeDriven 区分：
// 引擎观察过至少一个 tick 之后的切换才是时间推进造成。放在前端判断而不让 Rust
// 不发这条事件：首帧的休息屏接管、系统通知仍要照常走，只是特效不播。
watch(
  () => pulse.lastTransition,
  (t) => {
    if (!t) return;
    if (t.from === null && t.timeDriven !== true) return;
    const s = t.to.state;
    if (!s || s.kind !== "custom" || s.effectsEnabled === false) return;
    void playStateEffects(s);
  },
);
</script>

<template>
  <div
    class="flex h-full flex-col bg-base text-primary transition-colors duration-300"
  >
    <!-- 顶部：当前节奏 -->
    <header
      class="mx-5 mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-5 transition-colors duration-300"
    >
      <div class="flex items-center gap-4">
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl transition-colors duration-300"
          :style="{ backgroundColor: heroColor + '22' }"
        >
          {{ heroEmoji }}
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="text-xl font-semibold transition-colors duration-300"
              :style="{ color: heroColor }"
            >
              {{ heroLabel }}
            </span>
            <span
              v-if="running && pulse.snapshot?.scheduleName"
              class="rounded-full bg-raised/60 px-2.5 py-0.5 text-xs text-secondary"
            >
              {{ pulse.snapshot.scheduleName }}
            </span>
            <span
              v-if="running && pulse.blockNote"
              class="rounded-full border border-line bg-base px-2.5 py-0.5 text-xs text-secondary"
              title="当前时间块的备注"
            >
              📝 {{ pulse.blockNote }}
            </span>
          </div>
          <div class="mt-1.5 text-sm text-secondary">
            {{ hintLine }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-5">
        <!-- 当前时间：唯一主角（引擎本地时钟，冒号呼吸） -->
        <div class="text-right">
          <div class="tnum text-5xl font-light leading-none tracking-tight">
            <span>{{ clock.hm.split(":")[0] }}</span
            ><span class="colon-blink" :class="{ 'opacity-100': clock.on }">:</span
            ><span>{{ clock.hm.split(":")[1] }}</span>
          </div>
          <div class="tnum mt-1.5 text-xs text-tertiary">
            {{ clock.on ? dateText : "时钟待引擎就绪" }}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="running && !pulse.isIdle"
            class="rounded-xl border border-line bg-raised/40 px-3 py-2 text-xs text-secondary transition hover:bg-raised hover:text-primary"
            title="本块剩余时间静默，下一块照常"
            @click="pulse.skipCurrentBlock()"
          >
            跳过此段
          </button>
          <button
            v-if="running"
            class="rounded-xl border border-line bg-raised/40 px-4 py-2 text-xs text-secondary transition hover:bg-raised hover:text-primary"
            @click="toggleRun"
          >
            ⏸ 停止
          </button>
          <button
            v-else
            class="rounded-xl bg-success px-5 py-2.5 text-sm font-semibold text-base-deep transition hover:opacity-90"
            @click="toggleRun"
          >
            ▶ 开始节奏
          </button>
        </div>
      </div>
    </header>

    <!-- Tabs -->
    <nav class="mx-5 mt-4 flex gap-1 rounded-xl bg-surface/60 p-1 text-sm">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="flex-1 rounded-lg px-4 py-2 transition"
        :class="
          tab === t.key
            ? 'bg-raised font-medium text-primary'
            : 'text-secondary hover:text-primary'
        "
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- 内容区：悬浮滚动条（不占宽度，与顶栏对齐） -->
    <main class="min-h-0 flex-1 px-5 py-4">
      <OverlayScroll>
        <ScheduleView v-if="tab === 'schedule'" />
        <StatesView v-else-if="tab === 'states'" @preview="playStateEffects" />
        <SettingsView v-else />
      </OverlayScroll>
    </main>

    <!-- 首次启动引导 -->
    <Onboarding v-if="config.settings && !config.settings.onboarded" />

    <!-- 特效层：特效播放器的挂载容器（结算画面等），平时不拦截任何交互 -->
    <div ref="effectLayer" class="pointer-events-none fixed inset-0 z-50"></div>
  </div>
</template>
