<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { usePulseStore } from "../../stores/pulse";

const pulse = usePulseStore();
const menuOpen = ref(false);

onMounted(() => pulse.init());
onUnmounted(() => (menuOpen.value = false));

const running = computed(() => pulse.running);
const shownColor = computed(() => (running.value ? pulse.color : "#928374"));
const shownEmoji = computed(() => (running.value ? pulse.emoji : "⏸"));
const shownLabel = computed(() => (running.value ? pulse.label : "已停止"));
const shownCountdown = computed(() =>
  running.value ? pulse.countdownText : "--:--",
);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

async function toggleRun() {
  menuOpen.value = false;
  await pulse.setRunning(!running.value);
}

async function skip() {
  menuOpen.value = false;
  await pulse.skipCurrentBlock();
}

async function openMain() {
  menuOpen.value = false;
  await invoke("show_main_window");
}

async function hideMini() {
  menuOpen.value = false;
  await invoke("set_mini_visible", { visible: false });
}
</script>

<template>
  <!-- 透明窗口 + 圆角卡片本体 -->
  <div class="h-full w-full p-1.5" style="-webkit-app-region: no-drag">
    <div
      data-tauri-drag-region
      class="relative flex h-full w-full select-none items-center gap-2.5 overflow-hidden rounded-2xl border border-line bg-surface px-3 transition-colors duration-300"
      :style="{
        borderColor: shownColor + '55',
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }"
      @dblclick="openMain"
    >
      <!-- 左侧状态色条 -->
      <div
        class="absolute inset-y-1.5 left-1 w-1 rounded-full transition-colors duration-300"
        :style="{ backgroundColor: shownColor }"
      />

      <div class="pointer-events-none ml-2 flex min-w-0 flex-1 items-center gap-2">
        <span
          class="text-xl leading-none"
          :class="pulse.state?.kind === 'slack' && running ? 'animate-pulse' : ''"
          :title="pulse.state?.kind === 'slack' && running ? '摸鱼中 · ⌘⇧H 一键掩护' : undefined"
        >{{ shownEmoji }}</span>
        <div class="min-w-0">
          <div class="flex items-baseline gap-1.5">
            <span
              class="truncate text-xs font-medium transition-colors duration-300"
              :style="{ color: shownColor }"
            >
              {{ shownLabel }}
            </span>
            <span
              v-if="running && pulse.blockNote"
              class="truncate text-[10px] text-secondary"
              :title="pulse.blockNote"
            >
              📝 {{ pulse.blockNote }}
            </span>
          </div>
          <div class="tnum text-lg font-bold leading-tight tracking-tight text-primary">
            {{ shownCountdown }}
          </div>
        </div>
      </div>

      <button
        class="shrink-0 rounded-lg px-1.5 py-1 text-xs text-tertiary transition hover:bg-raised hover:text-primary"
        title="菜单"
        @click="toggleMenu"
      >
        ⋯
      </button>

      <!-- 底部进度条 -->
      <div class="absolute inset-x-2 bottom-1 h-[3px] overflow-hidden rounded-full bg-raised/50">
        <div
          class="h-full rounded-full transition-[width] duration-1000 ease-linear"
          :style="{
            width: running ? (pulse.snapshot?.progress ?? 0) * 100 + '%' : '0%',
            backgroundColor: shownColor,
          }"
        />
      </div>

      <!-- 右键菜单弹层 -->
      <div
        v-if="menuOpen"
        class="absolute right-2 top-11 z-10 w-36 overflow-hidden rounded-xl border border-line bg-surface py-1 text-xs shadow-2xl"
      >
        <button
          class="block w-full px-3 py-2 text-left text-secondary transition hover:bg-raised hover:text-primary"
          @click="toggleRun"
        >
          {{ running ? "⏸ 停止节奏" : "▶ 启动节奏" }}
        </button>
        <button
          v-if="running && !pulse.isIdle"
          class="block w-full px-3 py-2 text-left text-secondary transition hover:bg-raised hover:text-primary"
          @click="skip"
        >
          跳过此段
        </button>
        <button
          class="block w-full px-3 py-2 text-left text-secondary transition hover:bg-raised hover:text-primary"
          @click="openMain"
        >
          打开主窗口
        </button>
        <button
          class="block w-full px-3 py-2 text-left text-secondary transition hover:bg-raised hover:text-primary"
          @click="hideMini"
        >
          隐藏迷你窗
        </button>
      </div>
    </div>
  </div>
</template>
