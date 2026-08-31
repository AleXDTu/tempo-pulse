<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useConfigStore } from "../../stores/config";
import { usePulseStore } from "../../stores/pulse";
import type { Schedule, TimeBlock } from "../../lib/types";
import TimelineBar from "../../components/TimelineBar.vue";
import TimePicker from "../../components/TimePicker.vue";
import { hhmmToMinutes, blockDuration } from "../../lib/format";

const config = useConfigStore();
const pulse = usePulseStore();

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

// 工作副本模式：编辑本地副本，保存后由广播回填；广播到达时若在编辑则不覆盖
const working = ref<Schedule[]>([]);
const selectedId = ref<string | null>(null);
const saveError = ref("");

const dirty = computed(
  () =>
    JSON.stringify(working.value) !== JSON.stringify(config.schedules) &&
    working.value.length > 0,
);

const selected = computed(
  () => working.value.find((s) => s.id === selectedId.value) ?? null,
);

function resetFromConfig() {
  if (dirty.value) return;
  working.value = JSON.parse(JSON.stringify(config.schedules));
  if (!working.value.find((s) => s.id === selectedId.value)) {
    selectedId.value = working.value[0]?.id ?? null;
  }
}
watch(
  () => config.schedules,
  resetFromConfig,
  { immediate: true },
);

// 校验：时间可解析且 end > start
function blockInvalid(b: TimeBlock): boolean {
  const s = hhmmToMinutes(b.start);
  const e = hhmmToMinutes(b.end);
  return s === null || e === null || e <= s;
}
const invalidCount = computed(
  () => working.value.flatMap((s) => s.blocks).filter(blockInvalid).length,
);

function addSchedule() {
  const s: Schedule = {
    id: crypto.randomUUID(),
    name: "新节奏",
    blocks: [],
    activeDays: [1, 2, 3, 4, 5],
  };
  working.value.push(s);
  selectedId.value = s.id;
}

function removeSchedule() {
  if (working.value.length <= 1) return;
  working.value = working.value.filter((s) => s.id !== selectedId.value);
  selectedId.value = working.value[0]?.id ?? null;
}

function toggleDay(s: Schedule, day: number) {
  const i = s.activeDays.indexOf(day);
  if (i >= 0) {
    s.activeDays.splice(i, 1);
  } else {
    s.activeDays.push(day);
    s.activeDays.sort((a, b) => a - b);
  }
}

function addBlock() {
  const s = selected.value;
  if (!s) return;
  const lastEnd = s.blocks.reduce<string>((acc, b) => {
    return hhmmToMinutes(b.end ?? "") !== null &&
      (hhmmToMinutes(b.end) ?? 0) > (hhmmToMinutes(acc) ?? 0)
      ? b.end
      : acc;
  }, "09:00");
  const startMin = Math.min(hhmmToMinutes(lastEnd) ?? 540, 1410);
  const defaultState =
    config.states.find((st) => st.kind === "focus")?.id ??
    config.states[0]?.id ??
    "";
  s.blocks.push({
    id: crypto.randomUUID(),
    start: fmt(startMin),
    end: fmt(Math.min(startMin + 30, 1440)),
    stateId: defaultState,
    note: null,
  });
}

function fmt(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function removeBlock(s: Schedule, id: string) {
  s.blocks = s.blocks.filter((b) => b.id !== id);
}

function stateColor(id: string): string {
  return config.stateById(id)?.color ?? "#64748b";
}

async function save() {
  saveError.value = "";
  if (invalidCount.value > 0) {
    saveError.value = "有时间块的开始/结束时间无效（需开始 < 结束）";
    return;
  }
  try {
    await config.saveSchedules(JSON.parse(JSON.stringify(working.value)));
  } catch (e) {
    saveError.value = String(e);
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 pb-4">
    <!-- 空状态 -->
    <div
      v-if="working.length === 0"
      class="rounded-2xl border border-dashed border-white/15 py-12 text-center"
    >
      <div class="text-4xl">🗓️</div>
      <p class="mt-3 text-sm text-slate-400">还没有时间表</p>
      <p class="mt-1 text-xs text-slate-500">
        点击下方「+ 新时间表」创建第一套节奏；不开始计时的话 App 会保持安静
      </p>
    </div>

    <!-- 时间表切换 -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="s in working"
        :key="s.id"
        class="rounded-full border px-4 py-1.5 text-sm transition"
        :class="
          s.id === selectedId
            ? 'border-sky-400/50 bg-sky-400/10 text-sky-200'
            : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
        "
        @click="selectedId = s.id"
      >
        {{ s.name }}
        <span class="ml-1 text-xs opacity-60">{{ s.blocks.length }} 段</span>
      </button>
      <button
        class="rounded-full border border-dashed border-white/15 px-3 py-1.5 text-sm text-slate-400 transition hover:text-slate-200"
        @click="addSchedule"
      >
        + 新时间表
      </button>
    </div>

    <template v-if="selected">
      <!-- 基本信息 + 生效日 -->
      <section
        class="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      >
        <div class="flex items-center gap-3">
          <input
            v-model="selected.name"
            class="w-56 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-sky-400/50"
            placeholder="时间表名称"
          />
          <div class="flex gap-1">
            <button
              v-for="(label, i) in DAY_LABELS"
              :key="i"
              class="h-8 w-8 rounded-lg text-xs transition"
              :class="
                selected.activeDays.includes(i + 1)
                  ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40'
                  : 'bg-white/5 text-slate-500 hover:text-slate-300'
              "
              :title="`周${label}生效`"
              @click="toggleDay(selected, i + 1)"
            >
              {{ label }}
            </button>
          </div>
          <div class="flex-1"></div>
          <button
            v-if="working.length > 1"
            class="rounded-lg border border-red-400/20 px-3 py-1.5 text-xs text-red-300/80 transition hover:bg-red-400/10"
            @click="removeSchedule"
          >
            删除此表
          </button>
        </div>

        <!-- 24h 可视化 -->
        <TimelineBar
          :schedule="selected"
          :state-of="config.stateById"
          :now="pulse.snapshot?.now?.slice(0, 5) ?? null"
        />
        <p
          v-if="config.settings?.legalDays.enabled"
          class="text-xs text-slate-500"
        >
          已启用法定工作日：法定节假日按「周末节奏」、调休补班日按「工作日节奏」自动切换
        </p>
      </section>

      <!-- 时间块列表 -->
      <section
        class="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-slate-300">时间块</h3>
          <button
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
            @click="addBlock"
          >
            + 添加时间块
          </button>
        </div>

        <p
          v-if="selected.blocks.length === 0"
          class="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-slate-500"
        >
          这一天还没有安排，添加第一个时间块吧
        </p>

        <div
          v-for="b in selected.blocks"
          :key="b.id"
          class="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
          :class="
            blockInvalid(b)
              ? 'border-red-400/40 bg-red-400/5'
              : 'border-white/5 bg-white/[0.02]'
          "
        >
          <span
            class="h-8 w-1.5 shrink-0 rounded-full"
            :style="{ backgroundColor: stateColor(b.stateId) }"
          />
          <TimePicker v-model="b.start" />
          <span class="text-slate-500">→</span>
          <TimePicker v-model="b.end" />
          <select
            v-model="b.stateId"
            class="h-8 rounded-lg border border-white/10 bg-slate-800 px-2 py-0 text-sm outline-none focus:border-sky-400/50"
          >
            <option v-for="st in config.states" :key="st.id" :value="st.id">
              {{ st.emoji ? st.emoji + " " : "" }}{{ st.label }}
            </option>
          </select>
          <input
            v-model="b.note"
            class="h-8 min-w-32 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0 text-sm text-slate-300 outline-none placeholder:text-slate-600 focus:border-sky-400/50"
            placeholder="备注（可选）"
          />
          <span class="tnum w-14 text-right text-xs text-slate-500">
            {{ blockDuration(b.start, b.end) }} 分钟
          </span>
          <button
            class="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-red-400/10 hover:text-red-300"
            title="删除此块"
            @click="removeBlock(selected, b.id)"
          >
            ✕
          </button>
        </div>
      </section>

      <!-- 保存 -->
      <div class="flex items-center justify-end gap-3">
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <span v-else-if="invalidCount > 0" class="text-xs text-red-400">
          {{ invalidCount }} 个时间块时间无效
        </span>
        <span v-else-if="dirty" class="text-xs text-amber-300/80">
          有未保存的更改
        </span>
        <button
          class="rounded-xl bg-sky-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:opacity-40"
          :disabled="!dirty && invalidCount === 0"
          @click="save"
        >
          保存时间表
        </button>
      </div>
    </template>
  </div>
</template>
