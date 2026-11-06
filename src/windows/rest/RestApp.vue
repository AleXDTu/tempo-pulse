<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { motion } from "motion-v";
import { usePulseStore } from "../../stores/pulse";
import { useConfigStore } from "../../stores/config";
import { onRestDismissed } from "../../lib/events";
import { formatCountdown } from "../../lib/format";

const pulse = usePulseStore();
const config = useConfigStore();

let unlisten: (() => void) | null = null;

onMounted(async () => {
  await Promise.all([pulse.init(), config.init()]);
  unlisten = await onRestDismissed(() => {
    /* 引擎侧已隐藏窗口，前端无需处理 */
  });
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  unlisten?.();
  window.removeEventListener("keydown", onKeydown);
});

const settings = computed(() => config.settings?.restScreen);
const strictness = computed(() => settings.value?.strictness ?? "skippable");
/** 小窗模式：置顶弹出、顶部拖动条可移动；全屏模式保持接管式布局 */
const windowMode = computed(() => settings.value?.mode === "window");

const canSkip = computed(() => strictness.value === "skippable");

const countdown = computed(() =>
  pulse.snapshot ? formatCountdown(pulse.snapshot.remainingSecs) : "--:--",
);

const nextHint = computed(() => {
  const s = pulse.snapshot;
  if (!s?.nextAt) return "休息结束后回来";
  return `${s.nextAt} 回到「${s.nextStateLabel ?? "下一站"}」`;
});

const bgStyle = computed(() => {
  const s = settings.value;
  if (!s) return { background: "#1d2021" };
  if (s.bgType === "color") return { background: s.bgValue || "#1d2021" };
  if (s.bgType === "gradient") return { background: s.bgValue };
  return {
    backgroundImage: `url(${convertFileSrc(s.bgValue)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
});

async function skip() {
  await invoke("skip_current_block");
}

async function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && strictness.value === "skippable") {
    // 可跳过模式下 Esc = 关屏但休息继续（不跳过）
    await invoke("dismiss_rest_screen");
  }
}
</script>

<template>
  <!-- 窗口模式外层留透明边距，露出圆角卡片 -->
  <div :class="windowMode ? 'h-full w-full p-2' : 'h-full w-full'">
    <div
      class="relative h-full w-full overflow-hidden"
      :class="windowMode ? 'rounded-2xl shadow-2xl ring-1 ring-white/20' : ''"
      :style="bgStyle"
    >
      <!-- 背景之上加一层暗化，保证文字可读 -->
      <div class="absolute inset-0 bg-black/35" />

      <!-- 小窗模式：顶部拖动条（无边框窗口靠它移动） -->
      <div
        v-if="windowMode"
        data-tauri-drag-region
        class="absolute inset-x-0 top-0 z-20 flex h-10 cursor-grab items-center justify-between px-3 active:cursor-grabbing"
      >
        <span class="text-xs text-white/60">☕ 休息中</span>
        <span class="text-[10px] text-white/40">拖动移动 · {{ settings?.title?.slice(0, 8) }}</span>
      </div>

      <div
        class="relative z-10 flex h-full flex-col items-center justify-center gap-6"
        :class="windowMode ? 'px-6 pb-2 pt-10' : ''"
      >
        <motion.div
          :initial="{ opacity: 0, y: 24, scale: 0.97 }"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :transition="{ duration: 0.6, ease: 'easeOut' }"
          class="text-center"
        >
          <h1
            class="font-bold tracking-wide text-white"
            :class="windowMode ? 'text-2xl' : 'text-5xl'"
          >
            {{ settings?.title || "该休息啦 ☕" }}
          </h1>
          <!-- 时间块备注充当副标题 -->
          <p
            v-if="pulse.blockNote"
            class="mt-3 text-white/75"
            :class="windowMode ? 'text-sm' : 'text-lg'"
          >
            {{ pulse.blockNote }}
          </p>
        </motion.div>

        <motion.div
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :transition="{ duration: 0.9, delay: 0.3 }"
          class="text-center"
        >
          <div
            class="tnum font-extralight text-white/95"
            :class="windowMode ? 'text-6xl' : 'text-8xl'"
          >
            {{ countdown }}
          </div>
          <div class="mt-3 text-sm text-white/60">{{ nextHint }}</div>
        </motion.div>

        <motion.div
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :transition="{ duration: 0.9, delay: 0.8 }"
          class="flex items-center gap-3"
          :class="windowMode ? 'mt-2 w-full flex-col' : 'mt-6'"
        >
          <button
            v-if="canSkip"
            class="rounded-xl border border-white/25 px-6 py-2.5 text-sm text-white/80 backdrop-blur transition hover:bg-white/10"
            :class="windowMode ? 'w-full py-2' : ''"
            @click="skip"
          >
            跳过休息
          </button>
          <span v-if="strictness === 'locked'" class="text-xs text-white/40">
            休息结束前不提供退出 · 深呼吸 🌿
          </span>
        </motion.div>
      </div>

      <!-- 进度条：全屏模式在顶部，小窗模式在底部（顶部被拖动条占用） -->
      <div
        class="absolute z-10 h-1 bg-white/10"
        :class="windowMode ? 'inset-x-2 bottom-2 rounded-full' : 'inset-x-0 top-0'"
      >
        <div
          class="h-full rounded-full bg-white/70 transition-[width] duration-1000 ease-linear"
          :style="{ width: (pulse.snapshot?.progress ?? 0) * 100 + '%' }"
        />
      </div>
    </div>
  </div>
</template>
