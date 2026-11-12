<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { PulseState } from "../../lib/types";

/**
 * 结算特效：以状态色 / emoji 生成的卡片从顶部撒落、重力弹跳、渐次淡出
 * （蜘蛛纸牌 Win 结算的观感）。约 3 秒自动结束，点击任意处提前结束。
 */
const props = defineProps<{ state: PulseState }>();
const emit = defineEmits<{ done: [] }>();

/** 总时长 / 卡片持续撒落的窗口（毫秒） */
const DURATION_MS = 3000;
const SPAWN_WINDOW_MS = 1300;
const SPAWN_INTERVAL_MS = 80;
const SPAWN_BATCH = 3;
/** 重力加速度 px/s²、触底反弹阻尼、整体淡出时长 */
const GRAVITY = 1800;
const BOUNCE_DAMPING = 0.55;
const FADE_MS = 900;

const canvasEl = ref<HTMLCanvasElement | null>(null);

interface Card {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
}

const cards: Card[] = [];
let rafId = 0;
let startMs = 0;
let lastFrameMs = 0;
let lastSpawnMs = 0;
let ended = false;

function finish() {
  if (ended) return;
  ended = true;
  cancelAnimationFrame(rafId);
  emit("done");
}

/** 画布物理尺寸跟随窗口与 devicePixelRatio，绘制保持 CSS 像素坐标 */
function resize() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function spawnCards(w: number) {
  for (let i = 0; i < SPAWN_BATCH; i++) {
    const size = 34 + Math.random() * 22;
    cards.push({
      x: size + Math.random() * Math.max(w - size * 2, 1),
      y: -size,
      vx: (Math.random() - 0.5) * 300,
      vy: 50 + Math.random() * 120,
      size,
      rot: (Math.random() - 0.5) * 0.6,
      vr: (Math.random() - 0.5) * 4,
    });
  }
}

/** 圆角卡片路径（arcTo 全平台可用，不依赖较新的 ctx.roundRect） */
function cardPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function frame(now: number) {
  if (ended) return;
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const t = now - startMs;
  // 增量钳制：后台标签页回来时不跳帧
  const dt = Math.min((now - lastFrameMs) / 1000, 0.05);
  lastFrameMs = now;

  if (t < SPAWN_WINDOW_MS && now - lastSpawnMs >= SPAWN_INTERVAL_MS) {
    lastSpawnMs = now;
    spawnCards(w);
  }

  for (const c of cards) {
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    // 触底弹跳（阻尼衰减）；反弹速度过小则贴地滚停
    if (c.y + c.size > h) {
      c.y = h - c.size;
      if (Math.abs(c.vy) > 60) {
        c.vy = -c.vy * BOUNCE_DAMPING;
        c.vx *= 0.92;
        c.vr *= 0.7;
      } else {
        c.vy = 0;
        c.vx *= 0.8;
        c.vr = 0;
      }
    }
  }

  const fadeStart = DURATION_MS - FADE_MS;
  const alpha = t <= fadeStart ? 1 : Math.max(1 - (t - fadeStart) / FADE_MS, 0);

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = alpha;
  for (const c of cards) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = props.state.color;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 1;
    cardPath(ctx, -c.size / 2, -c.size / 2, c.size, c.size, c.size * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.font = `${Math.round(c.size * 0.5)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(props.state.emoji ?? "✨", 0, c.size * 0.04);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (t >= DURATION_MS) {
    finish();
    return;
  }
  rafId = requestAnimationFrame(frame);
}

onMounted(() => {
  resize();
  window.addEventListener("resize", resize);
  startMs = performance.now();
  lastFrameMs = startMs;
  lastSpawnMs = startMs - SPAWN_INTERVAL_MS; // 首帧立即撒落第一批
  rafId = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  ended = true;
  cancelAnimationFrame(rafId);
  window.removeEventListener("resize", resize);
});
</script>

<template>
  <!-- 特效层容器是 pointer-events:none，这里显式恢复以接收点击（提前结束） -->
  <div class="finale" @click="finish">
    <canvas ref="canvasEl" class="finale-canvas"></canvas>
  </div>
</template>

<style scoped>
.finale {
  position: fixed;
  inset: 0;
  z-index: 50;
  cursor: pointer;
  pointer-events: auto;
}

.finale-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
