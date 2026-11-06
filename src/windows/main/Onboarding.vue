<script setup lang="ts">
import { ref } from "vue";
import { useConfigStore } from "../../stores/config";
import type { ThemeName } from "../../lib/types";
import { RHYTHM_TEMPLATES, buildDayBlocks, stateIdByKind } from "../../lib/rhythm";
import { applyTheme } from "../../lib/theme";

/**
 * 首次启动引导：欢迎 → 确认状态 → 选节奏预设 → 完成并开始。
 * 随时可跳过；跳过后保持停止，不打扰用户自己探索。
 */
const config = useConfigStore();

const step = ref(1);
const total = 3;
const preset = ref<string>("balanced");
const busy = ref(false);

function tplByKey(key: string) {
  return RHYTHM_TEMPLATES.find((t) => t.key === key) ?? RHYTHM_TEMPLATES[0];
}

/** 选定节奏 → 生成工作日 + 周末两套时间表 */
function buildSchedules() {
  const tpl = tplByKey(preset.value);
  const ids = {
    focus: stateIdByKind(config.states, "focus"),
    slack: stateIdByKind(config.states, "slack"),
    rest: stateIdByKind(config.states, "rest"),
  };
  const blocks = tplByKey(preset.value) && preset.value !== "blank" ? buildDayBlocks(tpl, ids) : [];
  return [
    { id: crypto.randomUUID(), name: "工作日节奏", blocks, activeDays: [1, 2, 3, 4, 5] },
    { id: crypto.randomUUID(), name: "周末节奏", blocks: [], activeDays: [6, 7] },
  ];
}

async function finish() {
  busy.value = true;
  try {
    const st = config.settings!;
    const isBlank = preset.value === "blank";
    if (!isBlank) {
      await config.saveSchedules(buildSchedules());
    }
    await config.saveSettings({ ...st, onboarded: true, running: !isBlank });
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

function chooseTheme(t: ThemeName) {
  const st = config.settings;
  if (!st) return;
  st.theme = t;
  applyTheme(t);
}
</script>

<template>
  <div
    v-if="config.settings"
    class="absolute inset-0 z-50 flex items-center justify-center bg-base/85 p-8 backdrop-blur-sm"
  >
    <div class="w-full max-w-lg rounded-3xl border border-line bg-surface p-8 shadow-2xl">
      <!-- 进度点 -->
      <div class="mb-6 flex items-center justify-center gap-2">
        <span
          v-for="i in total"
          :key="i"
          class="h-1.5 rounded-full transition-all"
          :class="
            i === step
              ? 'w-6 bg-accent'
              : i < step
                ? 'w-1.5 bg-accent/50'
                : 'w-1.5 bg-raised'
          "
        />
      </div>

      <!-- Step 1 欢迎 -->
      <div v-if="step === 1" class="text-center">
        <div class="text-5xl">⏱️</div>
        <h2 class="mt-4 text-2xl font-bold text-primary">欢迎使用 Tempo Pulse</h2>
        <p class="mt-3 text-sm leading-relaxed text-secondary">
          你的时间节奏，由你自己定义。
          把一天切成一段段时间块，每段绑定一个状态——
          什么时间认真工作、什么时间摸鱼、什么时间强制休息，全部说了算。
        </p>
        <ul class="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-primary/90">
          <li class="flex items-center gap-2">
            <span class="text-success">●</span> 迷你悬浮窗常驻显示倒计时与备注
          </li>
          <li class="flex items-center gap-2">
            <span class="text-accent">●</span> 到点切换状态并发通知
          </li>
          <li class="flex items-center gap-2">
            <span class="text-warning">●</span> 休息时段自动弹出休息屏
          </li>
        </ul>
        <p class="mt-5 text-xs text-tertiary">先挑一个顺眼的主题，之后随时可在设置里换</p>
        <div class="mt-3 flex justify-center gap-2">
          <button
            v-for="t in [
              { key: 'dark', label: '深色', swatches: ['#282828', '#3c3836', '#fbf1c7'] },
              { key: 'light', label: '浅色', swatches: ['#fbf1c7', '#ebdbb2', '#3c3836'] },
            ]"
            :key="t.key"
            class="flex items-center gap-2 rounded-xl border p-2 pr-3 transition"
            :class="
              config.settings!.theme === t.key
                ? 'border-accent bg-raised'
                : 'border-line bg-base-deep/40 hover:border-accent/40'
            "
            @click="chooseTheme(t.key as ThemeName)"
          >
            <span class="flex gap-0.5">
              <span
                v-for="c in t.swatches"
                :key="c"
                class="h-4 w-4 rounded ring-1 ring-black/10"
                :style="{ backgroundColor: c }"
              />
            </span>
            <span class="text-xs text-primary">{{ t.label }}</span>
          </button>
        </div>
      </div>

      <!-- Step 2 状态 -->
      <div v-else-if="step === 2" class="text-center">
        <h2 class="text-2xl font-bold text-primary">先认识一下「状态」</h2>
        <p class="mt-3 text-sm text-secondary">
          时间块绑定状态，状态决定颜色和它的「反应」——
          休息会弹屏、专注会收尾预告、摸鱼能一键掩护。
          已为你准备了三个常用的，之后可在「状态」页随意添加。
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
        <p class="mt-5 text-xs text-tertiary">
          「休息」类型的状态会触发休息屏（全屏或小窗，可在设置中选）
        </p>
      </div>

      <!-- Step 3 节奏预设 -->
      <div v-else class="text-center">
        <h2 class="text-2xl font-bold text-primary">选一个工作日节奏</h2>
        <p class="mt-3 text-sm text-secondary">
          生成周一到周五的时间表（9:00-18:00 含午休），之后随时可精细调整
        </p>
        <div class="mt-5 space-y-2 text-left">
          <label
            v-for="t in RHYTHM_TEMPLATES"
            :key="t.key"
            class="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition"
            :class="
              preset === t.key
                ? 'border-accent bg-raised'
                : 'border-line bg-base-deep/30 hover:border-accent/40'
            "
          >
            <input
              v-model="preset"
              type="radio"
              :value="t.key"
              class="mt-1"
            />
            <div>
              <div class="text-sm font-medium text-primary">{{ t.name }}</div>
              <div class="mt-0.5 text-xs text-tertiary">{{ t.desc }}</div>
            </div>
          </label>
          <label
            class="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition"
            :class="
              preset === 'blank'
                ? 'border-accent bg-raised'
                : 'border-line bg-base-deep/30 hover:border-accent/40'
            "
          >
            <input
              v-model="preset"
              type="radio"
              value="blank"
              class="mt-1"
            />
            <div>
              <div class="text-sm font-medium text-primary">空白时间表</div>
              <div class="mt-0.5 text-xs text-tertiary">跳过预设，稍后在「时间表」页自己搭</div>
            </div>
          </label>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="mt-8 flex items-center justify-between">
        <button
          class="rounded-xl px-4 py-2 text-sm text-tertiary transition hover:text-secondary"
          :disabled="busy"
          @click="skip"
        >
          跳过引导
        </button>
        <div class="flex gap-2">
          <button
            v-if="step > 1"
            class="rounded-xl border border-line px-4 py-2 text-sm text-secondary transition hover:bg-raised"
            @click="step--"
          >
            上一步
          </button>
          <button
            v-if="step < total"
            class="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-on-accent transition hover:opacity-90"
            @click="step++"
          >
            下一步
          </button>
          <button
            v-else
            class="rounded-xl bg-success px-5 py-2 text-sm font-semibold text-on-accent transition hover:opacity-90 disabled:opacity-50"
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
