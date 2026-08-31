<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useConfigStore } from "../../stores/config";
import type { RestBgType, RestMode, RestStrictness, Settings } from "../../lib/types";

const config = useConfigStore();

const GRADIENT_PRESETS = [
  "linear-gradient(135deg, #0f172a 0%, #312e81 50%, #581c87 100%)",
  "linear-gradient(160deg, #052e2b 0%, #065f46 60%, #0f766e 100%)",
  "linear-gradient(135deg, #1e1b4b 0%, #7c2d12 100%)",
  "linear-gradient(180deg, #020617 0%, #0c4a6e 100%)",
  "radial-gradient(ellipse at 30% 20%, #4c1d95 0%, #0f172a 60%)",
];

const STRICTNESSES: {
  value: RestStrictness;
  label: string;
  desc: string;
}[] = [
  {
    value: "skippable",
    label: "可跳过",
    desc: "全屏接管，随时可跳过休息",
  },
  {
    value: "postpone-once",
    label: "可延时一次",
    desc: "可「再躺 2 分钟」一次，之后到点自动回屏",
  },
  {
    value: "locked",
    label: "锁死",
    desc: "休息结束前没有退出按钮（仍可切走窗口）",
  },
];

const working = ref<Settings | null>(null);
const saveError = ref("");
const imageBusy = ref(false);

const dirty = computed(() => {
  if (!working.value || !config.settings) return false;
  const { mini: _mini, ...w } = working.value;
  const { mini: _m, ...c } = config.settings;
  return JSON.stringify(w) !== JSON.stringify(c);
});

function resetFromConfig() {
  if (dirty.value || !config.settings) return;
  working.value = JSON.parse(JSON.stringify(config.settings));
}
watch(
  () => config.settings,
  resetFromConfig,
  { immediate: true, deep: true },
);

const rest = computed(() => working.value?.restScreen);
const legal = computed(() => working.value?.legalDays);

const REST_MODES: { value: RestMode; label: string; desc: string }[] = [
  { value: "fullscreen", label: "全屏接管", desc: "铺满屏幕强制休息" },
  { value: "window", label: "小窗弹出", desc: "置顶小窗提醒，可拖动，不打断手头工作" },
];

async function openConfigDir() {
  try {
    await invoke("open_config_dir");
  } catch (e) {
    saveError.value = String(e);
  }
}

const previewStyle = computed(() => {
  if (!rest.value) return {};
  const r = rest.value;
  if (r.bgType === "color") return { background: r.bgValue || "#0f172a" };
  if (r.bgType === "gradient") return { background: r.bgValue };
  return {
    backgroundImage: `url(${convertFileSrc(r.bgValue)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
});

async function onImageChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !working.value) return;
  imageBusy.value = true;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const path = await config.saveRestBgImage(dataUrl);
    working.value.restScreen.bgValue = path;
  } catch (err) {
    saveError.value = String(err);
  } finally {
    imageBusy.value = false;
    (e.target as HTMLInputElement).value = "";
  }
}

const bgTypes: { value: RestBgType; label: string }[] = [
  { value: "color", label: "纯色" },
  { value: "gradient", label: "渐变" },
  { value: "image", label: "图片" },
];

async function save() {
  saveError.value = "";
  if (!working.value) return;
  try {
    await config.saveSettings(JSON.parse(JSON.stringify(working.value)));
  } catch (e) {
    saveError.value = String(e);
  }
}
</script>

<template>
  <div v-if="working" class="mx-auto max-w-4xl space-y-4 pb-4">
    <!-- 休息屏自定义 -->
    <section class="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div>
        <h3 class="text-sm font-medium text-slate-300">休息屏</h3>
        <p class="mt-0.5 text-xs text-slate-500">
          进入「休息」状态时全屏接管，按下面的样子展示
        </p>
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        <!-- 实时预览 -->
        <div
          class="flex h-52 items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/10"
          :style="previewStyle"
        >
          <div class="text-center drop-shadow">
            <div class="text-lg font-semibold text-white/95">
              {{ rest?.title || "该休息啦" }}
            </div>
            <div class="mt-2 tnum text-4xl font-bold text-white">14:59</div>
            <div class="mt-2 text-xs text-white/70">
              {{ rest?.subtitle || "离开屏幕，站起来走走" }}
            </div>
          </div>
        </div>

        <!-- 配置项 -->
        <div class="space-y-3">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 text-slate-400">背景</span>
            <div class="flex gap-1 rounded-lg bg-white/5 p-1 text-xs">
              <button
                v-for="t in bgTypes"
                :key="t.value"
                class="rounded-md px-3 py-1 transition"
                :class="
                  rest?.bgType === t.value
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                "
                @click="rest!.bgType = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <!-- 纯色 -->
          <div v-if="rest?.bgType === 'color'" class="flex items-center gap-2 text-sm">
            <span class="w-16 text-slate-400">颜色</span>
            <input
              v-model="rest.bgValue"
              type="color"
              class="h-8 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
            />
          </div>

          <!-- 渐变 -->
          <div v-else-if="rest?.bgType === 'gradient'" class="space-y-2 text-sm">
            <span class="text-slate-400">预设渐变</span>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="g in GRADIENT_PRESETS"
                :key="g"
                class="h-9 w-14 rounded-lg ring-1 transition hover:scale-105"
                :class="rest.bgValue === g ? 'ring-sky-400' : 'ring-white/10'"
                :style="{ background: g }"
                @click="rest.bgValue = g"
              />
            </div>
            <input
              v-model="rest.bgValue"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-slate-300 outline-none focus:border-sky-400/50"
              placeholder="自定义 CSS background"
            />
          </div>

          <!-- 图片 -->
          <div v-else class="space-y-2 text-sm">
            <label
              class="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/15 px-3 py-4 text-xs text-slate-400 transition hover:border-sky-400/40 hover:text-slate-200"
            >
              {{ imageBusy ? "保存中…" : "选择本地图片（jpg / png / webp / gif）" }}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                class="hidden"
                @change="onImageChosen"
              />
            </label>
            <p v-if="rest?.bgValue" class="truncate text-xs text-slate-500">
              已设置背景图
            </p>
          </div>

          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-slate-400">标题</span>
            <input
              v-model="rest!.title"
              class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-sky-400/50"
              placeholder="该休息啦 ☕"
            />
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-slate-400">副标题</span>
            <input
              v-model="rest!.subtitle"
              class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-sky-400/50"
              placeholder="离开屏幕，站起来走走"
            />
          </div>
        </div>
      </div>

      <!-- 方式 -->
      <div class="space-y-2">
        <span class="text-sm text-slate-400">休息方式</span>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label
            v-for="m in REST_MODES"
            :key="m.value"
            class="cursor-pointer rounded-xl border p-3 transition"
            :class="
              rest?.mode === m.value
                ? 'border-sky-400/50 bg-sky-400/10'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
            "
          >
            <div class="flex items-center gap-2">
              <input
                v-model="rest!.mode"
                type="radio"
                :value="m.value"
                class="accent-sky-400"
              />
              <span class="text-sm font-medium text-slate-200">{{ m.label }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-500">{{ m.desc }}</p>
          </label>
        </div>
      </div>

      <!-- 强度 -->
      <div class="space-y-2">
        <span class="text-sm text-slate-400">强制强度</span>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label
            v-for="s in STRICTNESSES"
            :key="s.value"
            class="cursor-pointer rounded-xl border p-3 transition"
            :class="
              rest?.strictness === s.value
                ? 'border-sky-400/50 bg-sky-400/10'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
            "
          >
            <div class="flex items-center gap-2">
              <input
                v-model="rest!.strictness"
                type="radio"
                :value="s.value"
                class="accent-sky-400"
              />
              <span class="text-sm font-medium text-slate-200">{{ s.label }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-500">{{ s.desc }}</p>
          </label>
        </div>
      </div>
    </section>

    <!-- 法定工作日 -->
    <section
      v-if="legal"
      class="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <label class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-slate-300">法定工作日</h3>
          <p class="mt-0.5 text-xs text-slate-500">
            法定节假日按「周末节奏」循环，调休补班日按「工作日节奏」循环
          </p>
        </div>
        <input v-model="legal.enabled" type="checkbox" class="h-5 w-5 accent-sky-400" />
      </label>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3"
        :class="legal.enabled ? '' : 'opacity-40'"
      >
        <div class="flex gap-2 text-xs">
          <span class="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-300">
            内置节假日 {{ legal.holidays.length }} 天
          </span>
          <span class="rounded-full bg-orange-400/10 px-3 py-1 text-orange-300">
            补班 {{ legal.workdays.length }} 天
          </span>
          <span class="rounded-full bg-white/5 px-3 py-1 text-slate-400">
            默认 2026 年国务院官方安排
          </span>
        </div>
        <button
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
          title="config.json 中的 legalDays，可手动更新次年安排"
          @click="openConfigDir"
        >
          打开数据文件
        </button>
      </div>
    </section>

    <!-- 通用 -->
    <section class="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 class="text-sm font-medium text-slate-300">通用</h3>

      <label class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
        <div>
          <div class="text-sm text-slate-200">节奏切换通知</div>
          <div class="text-xs text-slate-500">每次进入新时间块时发送系统通知</div>
        </div>
        <input v-model="working.notifications" type="checkbox" class="h-5 w-5 accent-sky-400" />
      </label>

      <label class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
        <div>
          <div class="text-sm text-slate-200">开机自启</div>
          <div class="text-xs text-slate-500">登录后自动在托盘里跑起节奏</div>
        </div>
        <input v-model="working.autostart" type="checkbox" class="h-5 w-5 accent-sky-400" />
      </label>

      <label class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
        <div>
          <div class="text-sm text-slate-200">迷你悬浮窗</div>
          <div class="text-xs text-slate-500">常驻置顶小窗（快捷键 ⌘⇧B）</div>
        </div>
        <input v-model="working.mini.visible" type="checkbox" class="h-5 w-5 accent-sky-400" />
      </label>

      <label
        class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3 transition"
        :class="working.mini.visible ? '' : 'opacity-40'"
      >
        <div>
          <div class="text-sm text-slate-200">迷你窗跨桌面常驻</div>
          <div class="text-xs text-slate-500">
            切换桌面或全屏应用时，迷你窗仍然跟随显示
          </div>
        </div>
        <input
          v-model="working.mini.alwaysVisible"
          type="checkbox"
          class="h-5 w-5 accent-sky-400"
          :disabled="!working.mini.visible"
        />
      </label>

      <div class="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
        <div>
          <div class="text-sm text-slate-200">全局快捷键</div>
          <div class="text-xs text-slate-500">主窗口 ⌘⇧M · 迷你窗 ⌘⇧B（Windows 为 Ctrl⇧）</div>
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-3">
      <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
      <span v-else-if="dirty" class="text-xs text-amber-300/80">有未保存的更改</span>
      <button
        class="rounded-xl bg-sky-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:opacity-40"
        :disabled="!dirty"
        @click="save"
      >
        保存设置
      </button>
    </div>
  </div>
</template>
