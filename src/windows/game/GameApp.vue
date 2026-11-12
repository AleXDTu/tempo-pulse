<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startGame, type GameHandle } from "../../game";

const canvasRef = ref<HTMLCanvasElement | null>(null);
let handle: GameHandle | null = null;

/** 菜单退出/顶栏关闭：直接销毁游戏窗（关闭即销毁，不进「关闭转隐藏」） */
function closeWindow() {
  void getCurrentWindow().destroy();
}

onMounted(() => {
  if (!canvasRef.value) return;
  handle = startGame(canvasRef.value, {
    onExit: closeWindow,
  });
});

onUnmounted(() => {
  handle?.destroy();
  handle = null;
});
</script>

<template>
  <!-- 960×540 固定窗：画布铺满（480×270 逻辑分辨率整数倍放大），顶栏悬浮其上 -->
  <div class="relative h-screen w-screen overflow-hidden bg-[#101223]">
    <canvas
      ref="canvasRef"
      class="block h-full w-full"
      style="image-rendering: pixelated"
    ></canvas>

    <!-- 自绘顶栏：拖动区 + 标题 + 操作提示 + 关闭（悬浮在画布上，不占布局，画布保持整数倍） -->
    <div
      data-tauri-drag-region
      class="absolute inset-x-0 top-0 flex h-9 items-center justify-between bg-[#101223]/80 px-3 backdrop-blur-sm"
    >
      <span data-tauri-drag-region class="select-none text-xs font-medium text-[#ebdbb2]">
        摸鱼突击
      </span>
      <!-- 操作提示放画布外的 DOM 层，不压游戏画面（原来画在画布底部，和屋顶瓦片糊在一起） -->
      <span
        data-tauri-drag-region
        class="absolute left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-xs text-[#a89984]"
      >
        ←→ 转身 · ↑↓ 角度 · 空格跳 · J 射击 · Esc 暂停
      </span>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-md text-sm text-[#a89984] transition hover:bg-[#fb4934] hover:text-white"
        aria-label="关闭游戏窗口"
        @click="closeWindow"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>
