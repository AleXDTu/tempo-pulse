<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useConfigStore } from "../../stores/config";
import type { PulseState, StateKind } from "../../lib/types";

const config = useConfigStore();

const KINDS: { value: StateKind; label: string; hint: string; reaction: string }[] = [
  { value: "focus", label: "认真", hint: "进入时提醒", reaction: "结束前 5 分钟收尾预告" },
  { value: "slack", label: "摸鱼", hint: "轻松段", reaction: "结束前 2 分钟收敛预告 · ⌘⇧H 一键掩护" },
  { value: "rest", label: "休息", hint: "主动安排的休息", reaction: "弹出休息屏（全屏/小窗）" },
  { value: "custom", label: "自定义", hint: "只有切换通知", reaction: "仅切换通知" },
];

const working = ref<PulseState[]>([]);
const saveError = ref("");

const dirty = computed(
  () =>
    JSON.stringify(working.value) !== JSON.stringify(config.states) &&
    working.value.length > 0,
);

function resetFromConfig() {
  if (dirty.value) return;
  working.value = JSON.parse(JSON.stringify(config.states));
}
watch(
  () => config.states,
  resetFromConfig,
  { immediate: true },
);

// 被时间块引用的状态不可删除
const referencedIds = computed(() => {
  const set = new Set<string>();
  for (const s of config.schedules) {
    for (const b of s.blocks) set.add(b.stateId);
  }
  return set;
});

function addState() {
  working.value.push({
    id: crypto.randomUUID(),
    label: "新状态",
    emoji: "✨",
    color: "#d3869b",
    kind: "custom",
  });
}

function removeState(id: string) {
  working.value = working.value.filter((s) => s.id !== id);
}

async function save() {
  saveError.value = "";
  const labels = new Set<string>();
  for (const s of working.value) {
    const key = s.label.trim();
    if (!key) {
      saveError.value = "状态名称不能为空";
      return;
    }
    if (labels.has(key)) {
      saveError.value = `状态名称重复：「${key}」`;
      return;
    }
    labels.add(key);
  }
  if (!working.value.some((s) => s.kind === "rest")) {
    saveError.value = "至少保留一个「休息」类型的状态（休息屏依赖它）";
    return;
  }
  try {
    await config.saveStates(JSON.parse(JSON.stringify(working.value)));
  } catch (e) {
    saveError.value = String(e);
  }
}
</script>

<template>
  <div class="space-y-4 pb-4">
    <!-- 状态类型说明 -->
    <section class="rounded-2xl border border-line bg-surface p-5">
      <h3 class="text-sm font-medium text-secondary">状态类型与反应</h3>
      <p class="mt-0.5 text-xs text-tertiary">
        状态不只换个颜色——每种类型有自己的「反应」。预告提醒可在设置中关闭。
      </p>
      <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div
          v-for="k in KINDS"
          :key="k.value"
          class="rounded-xl border border-line bg-base-deep/30 px-3 py-2.5"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-primary">{{ k.label }}</span>
            <span class="text-xs text-tertiary">{{ k.hint }}</span>
          </div>
          <div class="mt-1 text-xs text-accent">⚡ {{ k.reaction }}</div>
        </div>
      </div>
    </section>

    <!-- 我的状态 -->
    <section class="rounded-2xl border border-line bg-surface p-5">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-secondary">我的状态</h3>
          <p class="mt-0.5 text-xs text-tertiary">
            时间块绑定状态；改类型即改变它的反应
          </p>
        </div>
        <button
          class="rounded-lg border border-line bg-base-deep/40 px-3 py-1.5 text-xs text-secondary transition hover:bg-raised hover:text-primary"
          @click="addState"
        >
          + 添加状态
        </button>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div
          v-for="s in working"
          :key="s.id"
          class="flex items-center gap-3 rounded-xl border border-line bg-base-deep/30 p-3"
        >
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
            :style="{ backgroundColor: s.color + '22' }"
          >
            <input
              v-model="s.emoji"
              maxlength="4"
              class="w-full bg-transparent text-center outline-none"
              title="表情"
            />
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex items-center gap-2">
              <input
                v-model="s.label"
                class="h-7 w-28 rounded-lg border border-line bg-base-deep/50 px-2 py-0 text-sm text-primary outline-none placeholder:text-tertiary/70 focus:border-accent"
                placeholder="名称"
              />
              <select
                v-model="s.kind"
                class="h-7 rounded-lg border border-line bg-surface px-2 py-0 text-xs text-primary outline-none"
                :title="KINDS.find((k) => k.value === s.kind)?.hint"
              >
                <option v-for="k in KINDS" :key="k.value" :value="k.value">
                  {{ k.label }}
                </option>
              </select>
              <label class="flex items-center gap-1 text-xs text-tertiary">
                <input
                  v-model="s.color"
                  type="color"
                  class="h-7 w-9 cursor-pointer rounded border-none bg-transparent"
                />
                颜色
              </label>
            </div>
            <p class="truncate text-xs text-accent/80">
              ⚡ {{ KINDS.find((k) => k.value === s.kind)?.reaction }}
            </p>
          </div>
          <button
            class="rounded-lg px-2 py-1 text-tertiary transition hover:bg-danger/15 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            :disabled="referencedIds.has(s.id)"
            :title="referencedIds.has(s.id) ? '已被时间块引用，不可删除' : '删除此状态'"
            @click="removeState(s.id)"
          >
            ✕
          </button>
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-3">
      <span v-if="saveError" class="text-xs text-danger">{{ saveError }}</span>
      <span v-else-if="dirty" class="text-xs text-warning/90">有未保存的更改</span>
      <button
        class="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-on-accent transition hover:opacity-90 disabled:opacity-40"
        :disabled="!dirty"
        @click="save"
      >
        保存状态
      </button>
    </div>
  </div>
</template>
