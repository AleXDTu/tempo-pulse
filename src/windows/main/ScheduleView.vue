<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useConfigStore } from "../../stores/config";
import { usePulseStore } from "../../stores/pulse";
import type { Schedule, TimeBlock } from "../../lib/types";
import TimelineBar from "../../components/TimelineBar.vue";
import TimePicker from "../../components/TimePicker.vue";
import { hhmmToMinutes, blockDuration } from "../../lib/format";
import {
  RHYTHM_TEMPLATES,
  buildDayBlocks,
  stateIdByKind,
  fmt,
  type RhythmTemplate,
} from "../../lib/rhythm";

const config = useConfigStore();
const pulse = usePulseStore();

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const CHIP_MINUTES = [25, 45, 55, 90];

// 工作副本模式：编辑本地副本，保存后由广播回填；广播到达时若在编辑则不覆盖
const working = ref<Schedule[]>([]);
const selectedId = ref<string | null>(null);
const saveError = ref("");
const applyError = ref("");
/** 待二次确认的模板 key（避免原生 confirm——WKWebView 不支持） */
const pendingTemplate = ref<string | null>(null);

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

// ---- 时间块：新增 / 模板 / 复制 / 时长 ----

/** 新块默认时长 = 上一块的时长（学习用户节奏）；指定 atMin 则从该分钟开始（时间条点击） */
function addBlock(atMin?: number) {
  const s = selected.value;
  if (!s) return;
  const defaultState =
    stateIdByKind(config.states, "focus") || config.states[0]?.id || "";
  let startMin: number;
  let durMin = 30;
  if (atMin !== undefined) {
    startMin = Math.max(0, Math.min(atMin, 1410));
  } else {
    const ends = s.blocks
      .map((b) => ({ start: hhmmToMinutes(b.start) ?? 0, end: hhmmToMinutes(b.end) ?? 0 }))
      .filter((b) => b.end > b.start)
      .sort((a, b) => a.end - b.end);
    const last = ends[ends.length - 1];
    startMin = last ? last.end : 540;
    if (last) durMin = Math.round(last.end - last.start);
    startMin = Math.min(startMin, 1410);
  }
  if (durMin <= 0 || !Number.isFinite(durMin)) durMin = 30;
  const nb: TimeBlock = {
    id: crypto.randomUUID(),
    start: fmt(startMin),
    end: fmt(Math.min(startMin + durMin, 1440)),
    stateId: defaultState,
    note: null,
  };
  s.blocks.push(nb);
  void nextTick(() => {
    listEl.value
      ?.querySelector(`[data-block-id="${nb.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

/** 一键套用节奏模板：替换当前时间表全部块（二次确认防误覆盖） */
function applyTemplate(tpl: RhythmTemplate) {
  const s = selected.value;
  if (!s) return;
  const ids = {
    focus: stateIdByKind(config.states, "focus"),
    slack: stateIdByKind(config.states, "slack"),
    rest: stateIdByKind(config.states, "rest"),
  };
  if (!ids.focus || !ids.rest) {
    applyError.value = "请先在「状态」页创建状态（至少包含专注与休息）";
    return;
  }
  applyError.value = "";
  if (s.blocks.length > 0 && pendingTemplate.value !== tpl.key) {
    pendingTemplate.value = tpl.key;
    setTimeout(() => {
      if (pendingTemplate.value === tpl.key) pendingTemplate.value = null;
    }, 3000);
    return;
  }
  pendingTemplate.value = null;
  s.blocks = buildDayBlocks(tpl, ids);
}

function copyBlock(s: Schedule, id: string) {
  const i = s.blocks.findIndex((b) => b.id === id);
  if (i < 0) return;
  const copy = { ...JSON.parse(JSON.stringify(s.blocks[i])), id: crypto.randomUUID() };
  s.blocks.splice(i + 1, 0, copy);
}

function setDuration(b: TimeBlock, min: number) {
  const s = hhmmToMinutes(b.start);
  if (s === null) return;
  b.end = fmt(Math.min(s + min, 1440));
}

function removeBlock(s: Schedule, id: string) {
  s.blocks = s.blocks.filter((b) => b.id !== id);
}

function stateColor(id: string): string {
  return config.stateById(id)?.color ?? "#928374";
}

// ---- 时间块拖动排序（指针事件实现）----
// WKWebView 里原生 HTML5 拖拽（draggable/drop）不生效，因此用
// pointerdown/move/up 自实现：按住把手拖动，列表实时重排。
const dragId = ref<string | null>(null);
const listEl = ref<HTMLElement | null>(null);

function rowEls(): HTMLElement[] {
  return listEl.value
    ? Array.from(listEl.value.querySelectorAll<HTMLElement>("[data-block-id]"))
    : [];
}

/** 根据指针 Y 计算目标下标并实时移动元素（在行中点之上则插到它前面） */
function dragTo(clientY: number) {
  const s = selected.value;
  if (!s || !dragId.value) return;

  // 指针接近列表可视区上下边缘时滚动容器
  const scroller = listEl.value?.closest("main");
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    if (clientY < sr.top + 48) scroller.scrollTop -= 12;
    else if (clientY > sr.bottom - 48) scroller.scrollTop += 12;
  }

  const rows = rowEls();
  let target = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) {
      target = i;
      break;
    }
  }
  const from = s.blocks.findIndex((b) => b.id === dragId.value);
  if (from < 0) return;
  let to = target;
  if (from < to) to -= 1;
  if (to === from) return;
  const [moved] = s.blocks.splice(from, 1);
  s.blocks.splice(to, 0, moved);
}

function startDrag(id: string, e: PointerEvent) {
  e.preventDefault(); // 阻止文本选择/原生拖拽
  dragId.value = id;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* 捕获失败也能靠 window 监听继续 */
  }
  const move = (ev: PointerEvent) => dragTo(ev.clientY);
  const up = () => {
    dragId.value = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  dragTo(e.clientY);
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
      class="rounded-2xl border border-dashed border-line py-12 text-center"
    >
      <div class="text-4xl">🗓️</div>
      <p class="mt-3 text-sm text-secondary">还没有时间表</p>
      <p class="mt-1 text-xs text-tertiary">
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
            ? 'border-accent/60 bg-accent/15 text-accent'
            : 'border-line bg-base-deep/40 text-secondary hover:text-primary'
        "
        @click="selectedId = s.id"
      >
        {{ s.name }}
        <span class="ml-1 text-xs opacity-60">{{ s.blocks.length }} 段</span>
      </button>
      <button
        class="rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-secondary transition hover:text-primary"
        @click="addSchedule"
      >
        + 新时间表
      </button>
    </div>

    <template v-if="selected">
      <!-- 基本信息 + 生效日 -->
      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center gap-3">
          <input
            v-model="selected.name"
            class="w-56 rounded-lg border border-line bg-base-deep/50 px-3 py-1.5 text-sm text-primary outline-none placeholder:text-tertiary/70 focus:border-accent"
            placeholder="时间表名称"
          />
          <div class="flex gap-1">
            <button
              v-for="(label, i) in DAY_LABELS"
              :key="i"
              class="h-8 w-8 rounded-lg text-xs transition"
              :class="
                selected.activeDays.includes(i + 1)
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
                  : 'bg-base-deep/40 text-tertiary hover:text-secondary'
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
            class="rounded-lg border border-danger/30 px-3 py-1.5 text-xs text-danger/90 transition hover:bg-danger/10"
            @click="removeSchedule"
          >
            删除此表
          </button>
        </div>

        <!-- 24h 可视化（点击空白时段快速加块） -->
        <TimelineBar
          :schedule="selected"
          :state-of="config.stateById"
          :now="pulse.snapshot?.now?.slice(0, 5) ?? null"
          @create-at="addBlock($event)"
        />
        <p v-if="applyError" class="text-xs text-danger">{{ applyError }}</p>
        <p v-if="config.settings?.legalDays.enabled" class="text-xs text-tertiary">
          已启用法定工作日：法定节假日按「周末节奏」、调休补班日按「工作日节奏」自动切换
        </p>
      </section>

      <!-- 时间块列表 -->
      <section ref="listEl" class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-secondary">
            时间块
            <span class="ml-1 text-xs font-normal text-tertiary">
              按住 ⋮⋮ 拖动排序 · 点击上方时间条空隙可快速加块
            </span>
          </h3>
          <button
            class="rounded-lg border border-line bg-base-deep/40 px-3 py-1.5 text-xs text-secondary transition hover:bg-raised hover:text-primary"
            @click="addBlock()"
          >
            + 添加时间块
          </button>
        </div>

        <!-- 节奏模板一键套用 -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-tertiary">一键套用：</span>
          <button
            v-for="tpl in RHYTHM_TEMPLATES"
            :key="tpl.key"
            class="rounded-lg border px-3 py-1.5 text-xs transition"
            :class="
              pendingTemplate === tpl.key
                ? 'border-warning/60 bg-warning/15 text-warning'
                : 'border-line bg-base-deep/40 text-secondary hover:border-accent/50 hover:text-accent'
            "
            :title="`${tpl.desc}（9:00-18:00 含午休）${pendingTemplate === tpl.key ? ' · 再点一次确认覆盖' : ''}`"
            @click="applyTemplate(tpl)"
          >
            {{ pendingTemplate === tpl.key ? "再点确认覆盖" : tpl.name }}
            <span class="ml-0.5 opacity-70">{{ tpl.focusMin }}+{{ tpl.breakMin }}</span>
          </button>
        </div>

        <p
          v-if="selected.blocks.length === 0"
          class="rounded-xl border border-dashed border-line py-8 text-center text-sm text-tertiary"
        >
          这一天还没有安排：点「+ 添加时间块」、套用上方模板、或直接点时间条空白处
        </p>

        <div
          v-for="b in selected.blocks"
          :key="b.id"
          :data-block-id="b.id"
          class="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition"
          :class="[
            blockInvalid(b)
              ? 'border-danger/60 bg-danger/10'
              : 'border-line bg-base-deep/40',
            dragId === b.id ? 'opacity-50 ring-1 ring-accent/50' : '',
          ]"
        >
          <span
            class="cursor-grab touch-none select-none px-0.5 text-xs leading-none text-tertiary transition hover:text-primary active:cursor-grabbing"
            title="拖动调整顺序"
            @pointerdown="startDrag(b.id, $event)"
          >⋮⋮</span>
          <span
            class="h-8 w-1.5 shrink-0 rounded-full"
            :style="{ backgroundColor: stateColor(b.stateId) }"
          />
          <TimePicker v-model="b.start" />
          <span class="text-tertiary">→</span>
          <TimePicker v-model="b.end" />
          <!-- 时长快捷 chips -->
          <div class="flex items-center gap-0.5">
            <button
              v-for="m in CHIP_MINUTES"
              :key="m"
              class="tnum rounded-md px-1.5 py-0.5 text-[10px] text-tertiary transition hover:bg-accent/20 hover:text-accent"
              :title="`设为 ${m} 分钟（从开始时间起算）`"
              @click="setDuration(b, m)"
            >
              {{ m }}′
            </button>
          </div>
          <select
            v-model="b.stateId"
            class="h-8 rounded-lg border border-line bg-surface px-2 py-0 text-sm text-primary outline-none focus:border-accent"
          >
            <option v-for="st in config.states" :key="st.id" :value="st.id">
              {{ st.emoji ? st.emoji + " " : "" }}{{ st.label }}
            </option>
          </select>
          <input
            v-model="b.note"
            class="h-8 min-w-32 flex-1 rounded-lg border border-line bg-base-deep/50 px-2 py-0 text-sm text-primary outline-none placeholder:text-tertiary/70 focus:border-accent"
            placeholder="备注（显示在迷你窗/休息屏/通知）"
          />
          <span class="tnum w-14 text-right text-xs text-tertiary">
            {{ blockDuration(b.start, b.end) }} 分钟
          </span>
          <div class="flex items-center gap-0.5">
            <button
              class="rounded-lg px-2 py-1 text-tertiary transition hover:bg-raised hover:text-primary"
              title="复制此块（插入其后）"
              @click="copyBlock(selected, b.id)"
            >
              ⧉
            </button>
            <button
              class="rounded-lg px-2 py-1 text-tertiary transition hover:bg-danger/15 hover:text-danger"
              title="删除此块"
              @click="removeBlock(selected, b.id)"
            >
              ✕
            </button>
          </div>
        </div>
      </section>

      <!-- 保存 -->
      <div class="flex items-center justify-end gap-3">
        <span v-if="saveError" class="text-xs text-danger">{{ saveError }}</span>
        <span v-else-if="invalidCount > 0" class="text-xs text-danger">
          {{ invalidCount }} 个时间块时间无效
        </span>
        <span v-else-if="dirty" class="text-xs text-warning/90">有未保存的更改</span>
        <button
          class="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-on-accent transition hover:opacity-90 disabled:opacity-40"
          :disabled="!dirty && invalidCount === 0"
          @click="save"
        >
          保存时间表
        </button>
      </div>
    </template>
  </div>
</template>
