<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * 时间选择器：点击 ▾ 弹出时/分两列下拉点选（分钟 5 步进），
 * 也可以直接在输入框键入 HH:MM，两种方式混用。
 */
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const open = ref(false);
const up = ref(false);
const root = ref<HTMLElement | null>(null);
const hourCol = ref<HTMLElement | null>(null);
const minuteCol = ref<HTMLElement | null>(null);

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const ITEM_H = 30;

const text = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => (text.value = v),
);

const parsed = computed(() => {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(text.value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return { h, min };
});

const minuteSel = computed(() =>
  parsed.value ? (Math.round(parsed.value.min / 5) * 5) % 60 : null,
);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function onInput() {
  // 键入过程中只回传合法值，避免中间态污染校验
  if (parsed.value) emit("update:modelValue", text.value);
}

function onBlur() {
  if (parsed.value) {
    text.value = `${pad(parsed.value.h)}:${pad(parsed.value.min)}`;
    emit("update:modelValue", text.value);
  } else {
    text.value = props.modelValue; // 非法输入回退
  }
}

function apply(h: number, min: number) {
  text.value = `${pad(h)}:${pad(min)}`;
  emit("update:modelValue", text.value);
}

function setH(h: number) {
  const min = minuteSel.value ?? 0;
  apply(h, min);
}

function setM(min: number) {
  apply(parsed.value?.h ?? 9, min);
  close();
}

function scrollToSel() {
  const scroll = (col: HTMLElement | null, idx: number | null) => {
    if (!col) return;
    col.scrollTop = Math.max(0, ((idx ?? 0) - 4) * ITEM_H);
  };
  scroll(hourCol.value, parsed.value?.h ?? null);
  scroll(minuteCol.value, minuteSel.value);
}

function toggle() {
  if (open.value) {
    close();
    return;
  }
  const r = root.value?.getBoundingClientRect();
  up.value = !!r && r.bottom + 264 > window.innerHeight;
  open.value = true;
  requestAnimationFrame(scrollToSel);
}

function close() {
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close();
}
onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="relative">
    <div class="relative">
      <input
        v-model="text"
        class="tnum h-8 w-[92px] rounded-lg border border-line bg-raised/40 px-2 pr-6 text-sm outline-none transition focus:border-accent"
        :class="parsed ? 'border-line' : 'border-danger/60'"
        placeholder="HH:MM"
        @input="onInput"
        @blur="onBlur"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button
        class="absolute right-0.5 top-1/2 -translate-y-1/2 px-1 text-[10px] text-tertiary transition hover:text-primary"
        tabindex="-1"
        title="下拉选择"
        @mousedown.prevent
        @click="toggle"
      >
        ▾
      </button>
    </div>

    <div
      v-if="open"
      class="absolute z-30 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-2xl"
      :class="up ? 'bottom-full mb-1' : 'top-full mt-1'"
    >
      <div ref="hourCol" class="h-56 overflow-y-auto rounded-lg bg-raised/30 p-1">
        <div class="px-2 py-0.5 text-[10px] text-tertiary">时</div>
        <button
          v-for="h in HOURS"
          :key="h"
          class="tnum flex h-[30px] w-full items-center justify-center rounded-md text-sm transition"
          :class="
            parsed?.h === h
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:bg-raised'
          "
          @click="setH(h)"
        >
          {{ pad(h) }}
        </button>
      </div>
      <div ref="minuteCol" class="h-56 overflow-y-auto rounded-lg bg-raised/30 p-1">
        <div class="px-2 py-0.5 text-[10px] text-tertiary">分</div>
        <button
          v-for="m in MINUTES"
          :key="m"
          class="tnum flex h-[30px] w-full items-center justify-center rounded-md text-sm transition"
          :class="
            minuteSel === m
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:bg-raised'
          "
          @click="setM(m)"
        >
          {{ pad(m) }}
        </button>
      </div>
    </div>
  </div>
</template>
