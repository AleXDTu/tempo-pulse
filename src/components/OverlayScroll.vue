<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref } from "vue";

/**
 * 悬浮滚动条容器：原理与 el-scrollbar 相同——隐藏原生条，
 * 绝对定位自绘滑块（不占布局宽度，内容可与外层栏对齐）。
 * 原生滚动行为不变（触控板/滚轮/键盘），滑块支持拖动。
 */
const wrap = ref<HTMLElement | null>(null);
const visible = ref(false);
const dragging = ref(false);
const scrollTop = ref(0);
const viewH = ref(1);
const scrollH = ref(1);
let hideTimer: number | undefined;

function measure() {
  const el = wrap.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollH.value = el.scrollHeight;
  viewH.value = el.clientHeight;
}

function show(ms = 700) {
  visible.value = true;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!dragging.value) visible.value = false;
  }, ms);
}

function onScroll() {
  measure();
  show();
}

function onEnter() {
  window.clearTimeout(hideTimer);
  visible.value = true;
}
function onLeave() {
  if (!dragging.value) show(250);
}

const needBar = computed(() => scrollH.value > viewH.value + 1);
const thumbH = computed(() =>
  Math.max(28, (viewH.value / Math.max(scrollH.value, 1)) * viewH.value),
);
const thumbTop = computed(() => {
  const track = viewH.value - thumbH.value;
  const ratio = scrollH.value - viewH.value;
  return ratio > 0 ? (scrollTop.value / ratio) * track : 0;
});

// ---- 滑块拖动 ----
let dragStartY = 0;
let dragStartTop = 0;

function onThumbDown(e: PointerEvent) {
  dragging.value = true;
  dragStartY = e.clientY;
  dragStartTop = thumbTop.value;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* 捕获失败靠 window 兜底 */
  }
  show();
}

function onThumbMove(e: PointerEvent) {
  if (!dragging.value || !wrap.value) return;
  const track = Math.max(viewH.value - thumbH.value, 1);
  const ratio = scrollH.value - viewH.value;
  const dy = e.clientY - dragStartY;
  wrap.value.scrollTop = dragStartTop + (dy / track) * ratio;
}

function onThumbUp() {
  dragging.value = false;
  show(250);
}

onMounted(measure);
onUpdated(measure); // 内容变化（切 tab/增删行）后重测滑块
onBeforeUnmount(() => window.clearTimeout(hideTimer));
</script>

<template>
  <div class="relative h-full" @mouseenter="onEnter" @mouseleave="onLeave">
    <div
      ref="wrap"
      class="no-scrollbar h-full overflow-y-auto"
      @scroll.passive="onScroll"
    >
      <slot />
    </div>
    <!-- 悬浮滑块：不占布局宽度 -->
    <div
      v-if="needBar"
      class="absolute right-0.5 w-1.5 cursor-default rounded-full bg-tertiary/60 transition-opacity duration-200 hover:bg-tertiary"
      :class="visible || dragging ? 'opacity-100' : 'opacity-0'"
      :style="{ height: thumbH + 'px', top: thumbTop + 'px' }"
      title="拖动滚动"
      @pointerdown.prevent="onThumbDown"
      @pointermove="onThumbMove"
      @pointerup="onThumbUp"
      @pointercancel="onThumbUp"
    />
  </div>
</template>
