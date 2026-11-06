<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useConfigStore } from "../../stores/config";
import type {
  RestBgType,
  RestMode,
  RestStrictness,
  Settings,
  ThemeName,
} from "../../lib/types";
import { applyTheme } from "../../lib/theme";

const config = useConfigStore();

const GRADIENT_PRESETS = [
  "linear-gradient(135deg, #1d2021 0%, #3c3836 50%, #7c4a1e 100%)",
  "linear-gradient(160deg, #1d2021 0%, #458588 60%, #689d6a 100%)",
  "linear-gradient(135deg, #3d2b1f 0%, #9d0006 100%)",
  "linear-gradient(180deg, #1d2021 0%, #076678 100%)",
  "radial-gradient(ellipse at 30% 20%, #8f3f71 0%, #1d2021 60%)",
];

const STRICTNESSES: {
  value: RestStrictness;
  label: string;
  desc: string;
}[] = [
  { value: "skippable", label: "可跳过", desc: "弹出休息屏，随时可跳过休息" },
  { value: "locked", label: "锁死", desc: "休息结束前没有退出按钮（仍可切走窗口）" },
];

const THEMES: { key: ThemeName; label: string; desc: string; swatches: string[] }[] = [
  {
    key: "dark",
    label: "深色",
    desc: "Gruvbox Dark · 夜间专注",
    swatches: ["#282828", "#3c3836", "#fbf1c7", "#fe8019"],
  },
  {
    key: "light",
    label: "浅色",
    desc: "Gruvbox Light · 日间清爽",
    swatches: ["#fbf1c7", "#ebdbb2", "#3c3836", "#458588"],
  },
];

const working = ref<Settings | null>(null);
const saveError = ref("");
const imageBusy = ref(false);
const appVersion = ref("");

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch {
    /* 版本接口不可用时留空 */
  }
  await loadHolidayInfo();
});

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

// ---- 主题：点击立即应用并持久化 ----
async function setTheme(t: ThemeName) {
  if (!working.value || working.value.theme === t) return;
  working.value.theme = t;
  applyTheme(t); // 本地即时生效，保存后广播同步其他窗口
  await save();
}

// ---- 法定节假日自动数据 ----
const holidayYears = ref<number[]>([]);
const holidayUpdating = ref(false);
const holidayMsg = ref("");
const holidayMsgOk = ref(true);

const lastUpdatedText = computed(() => {
  const raw = legal.value?.lastUpdated;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString("zh-CN", { hour12: false });
});

async function loadHolidayInfo() {
  try {
    const info = await invoke<{ years: number[]; lastUpdated: string | null }>(
      "get_holiday_info",
    );
    holidayYears.value = info.years;
  } catch {
    /* 忽略，界面显示占位 */
  }
}

async function checkHolidayUpdate() {
  holidayUpdating.value = true;
  holidayMsg.value = "";
  try {
    holidayMsg.value = await invoke<string>("check_holiday_update");
    holidayMsgOk.value = true;
    await loadHolidayInfo();
  } catch (e) {
    holidayMsg.value = String(e);
    holidayMsgOk.value = false;
  } finally {
    holidayUpdating.value = false;
  }
}

const previewStyle = computed(() => {
  if (!rest.value) return {};
  const r = rest.value;
  if (r.bgType === "color") return { background: r.bgValue || "#1d2021" };
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
  <div v-if="working" class="space-y-4 pb-4">
    <!-- 外观 -->
    <section class="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h3 class="text-sm font-medium text-secondary">外观</h3>
        <p class="mt-0.5 text-xs text-tertiary">gruvbox 双主题，点击立即应用到全部窗口</p>
      </div>
      <div class="grid grid-cols-2 gap-3 md:max-w-xl">
        <button
          v-for="t in THEMES"
          :key="t.key"
          class="rounded-xl border p-3 text-left transition"
          :class="
            working.theme === t.key
              ? 'border-accent bg-raised'
              : 'border-line bg-base-deep/40 hover:border-accent'
          "
          @click="setTheme(t.key)"
        >
          <div class="flex gap-1">
            <span
              v-for="c in t.swatches"
              :key="c"
              class="h-6 w-6 rounded-md ring-1 ring-black/10"
              :style="{ backgroundColor: c }"
            />
          </div>
          <div class="mt-2 text-sm font-medium text-primary">{{ t.label }}</div>
          <div class="text-xs text-tertiary">{{ t.desc }}</div>
        </button>
      </div>
    </section>

    <!-- 休息屏自定义 -->
    <section class="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h3 class="text-sm font-medium text-secondary">休息屏</h3>
        <p class="mt-0.5 text-xs text-tertiary">
          进入「休息」状态时按下面的样子展示；标题下方显示当前块的备注
        </p>
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        <!-- 实时预览 -->
        <div
          class="flex h-52 items-center justify-center overflow-hidden rounded-xl ring-1 ring-line"
          :style="previewStyle"
        >
          <div class="rounded-lg bg-black/35 px-6 py-4 text-center">
            <div class="text-lg font-semibold text-white/95">
              {{ rest?.title || "该休息啦" }}
            </div>
            <div class="mt-2 tnum text-4xl font-bold text-white">14:59</div>
            <div class="mt-2 text-xs text-white/70">📝 时间块备注会显示在这里</div>
          </div>
        </div>

        <!-- 配置项 -->
        <div class="space-y-3">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 text-secondary">背景</span>
            <div class="flex gap-1 rounded-lg bg-base-deep/40 p-1 text-xs">
              <button
                v-for="t in bgTypes"
                :key="t.value"
                class="rounded-md px-3 py-1 transition"
                :class="
                  rest?.bgType === t.value
                    ? 'bg-raised text-primary'
                    : 'text-secondary hover:text-primary'
                "
                @click="rest!.bgType = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <!-- 纯色 -->
          <div v-if="rest?.bgType === 'color'" class="flex items-center gap-2 text-sm">
            <span class="w-16 text-secondary">颜色</span>
            <input
              v-model="rest.bgValue"
              type="color"
              class="h-8 w-14 cursor-pointer rounded border border-line bg-transparent"
            />
          </div>

          <!-- 渐变 -->
          <div v-else-if="rest?.bgType === 'gradient'" class="space-y-2 text-sm">
            <span class="text-secondary">预设渐变</span>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="g in GRADIENT_PRESETS"
                :key="g"
                class="h-9 w-14 rounded-lg transition hover:scale-105"
                :class="rest.bgValue === g ? 'border-2 border-accent' : 'border border-line'"
                :style="{ background: g }"
                @click="rest.bgValue = g"
              />
            </div>
            <input
              v-model="rest.bgValue"
              class="w-full rounded-lg border border-line bg-base-deep/50 px-3 py-1.5 font-mono text-xs text-primary outline-none placeholder:text-tertiary/70 focus:border-accent"
              placeholder="自定义 CSS background"
            />
          </div>

          <!-- 图片 -->
          <div v-else class="space-y-2 text-sm">
            <label
              class="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line px-3 py-4 text-xs text-secondary transition hover:border-accent hover:text-primary"
            >
              {{ imageBusy ? "保存中…" : "选择本地图片（jpg / png / webp / gif）" }}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                class="hidden"
                @change="onImageChosen"
              />
            </label>
            <p v-if="rest?.bgValue" class="truncate text-xs text-tertiary">已设置背景图</p>
          </div>

          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-secondary">标题</span>
            <input
              v-model="rest!.title"
              class="flex-1 rounded-lg border border-line bg-base-deep/50 px-3 py-1.5 text-sm text-primary outline-none placeholder:text-tertiary/70 focus:border-accent"
              placeholder="该休息啦 ☕"
            />
          </div>
          <p class="text-xs text-tertiary">
            副标题已由时间块的「备注」充当——配置备注即显示在休息屏上
          </p>
        </div>
      </div>

      <!-- 方式 -->
      <div class="space-y-2">
        <span class="text-sm text-secondary">休息方式</span>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label
            v-for="m in REST_MODES"
            :key="m.value"
            class="cursor-pointer rounded-xl border p-3 transition"
            :class="
              rest?.mode === m.value
                ? 'border-accent bg-raised'
                : 'border-line bg-base-deep/30 hover:border-accent'
            "
          >
            <div class="flex items-center gap-2">
              <input
                v-model="rest!.mode"
                type="radio"
                :value="m.value"
                class="h-4 w-4"
              />
              <span class="text-sm font-medium text-primary">{{ m.label }}</span>
            </div>
            <p class="mt-1 text-xs text-tertiary">{{ m.desc }}</p>
          </label>
        </div>
      </div>

      <!-- 强度 -->
      <div class="space-y-2">
        <span class="text-sm text-secondary">强制强度</span>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label
            v-for="s in STRICTNESSES"
            :key="s.value"
            class="cursor-pointer rounded-xl border p-3 transition"
            :class="
              rest?.strictness === s.value
                ? 'border-accent bg-raised'
                : 'border-line bg-base-deep/30 hover:border-accent'
            "
          >
            <div class="flex items-center gap-2">
              <input
                v-model="rest!.strictness"
                type="radio"
                :value="s.value"
                class="h-4 w-4"
              />
              <span class="text-sm font-medium text-primary">{{ s.label }}</span>
            </div>
            <p class="mt-1 text-xs text-tertiary">{{ s.desc }}</p>
          </label>
        </div>
      </div>
    </section>

    <!-- 法定工作日 -->
    <section v-if="legal" class="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <label class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-secondary">法定工作日</h3>
          <p class="mt-0.5 text-xs text-tertiary">
            法定节假日按「周末节奏」循环，调休补班日按「工作日节奏」循环
          </p>
        </div>
        <input v-model="legal.enabled" type="checkbox" class="h-5 w-5" />
      </label>

      <div
        class="space-y-3 rounded-xl bg-base-deep/30 px-4 py-3"
        :class="legal.enabled ? '' : 'opacity-40'"
      >
        <!-- 数据概况 -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full bg-raised/50 px-3 py-1 text-success">
            数据来源 holiday-cn
          </span>
          <span class="rounded-full bg-raised/50 px-3 py-1 text-secondary">
            已加载 {{ holidayYears.length > 0 ? holidayYears.join(" / ") : "—" }} 年
          </span>
          <span v-if="lastUpdatedText" class="rounded-full bg-raised/50 px-3 py-1 text-secondary">
            更新于 {{ lastUpdatedText }}
          </span>
          <span v-else class="rounded-full bg-raised/50 px-3 py-1 text-secondary">
            使用内置离线数据
          </span>
        </div>

        <!-- 更新控制 -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <button
              class="rounded-lg border border-line bg-base-deep/40 px-3 py-1.5 text-xs text-secondary transition hover:bg-raised hover:text-primary disabled:opacity-40"
              :disabled="holidayUpdating || !legal.enabled"
              @click="checkHolidayUpdate"
            >
              {{ holidayUpdating ? "检查中…" : "立即检查更新" }}
            </button>
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-secondary">
              <input
                v-model="legal.autoUpdate"
                type="checkbox"
                class="h-4 w-4"
                :disabled="!legal.enabled"
              />
              自动更新（每 24 小时）
            </label>
          </div>
          <button
            class="rounded-lg border border-line bg-base-deep/40 px-3 py-1.5 text-xs text-secondary transition hover:bg-raised hover:text-primary"
            title="config.json 中可手动补充特殊日期"
            @click="openConfigDir"
          >
            打开数据文件
          </button>
        </div>

        <p v-if="holidayMsg" :class="holidayMsgOk ? 'text-xs text-success' : 'text-xs text-danger'">
          {{ holidayMsg }}
        </p>
        <p class="text-xs text-tertiary">
          数据在国务院安排公布后自动跟随更新；如需手动补充特殊日期，可编辑 config.json 中的
          legalDays.holidays / workdays
        </p>
      </div>
    </section>

    <!-- 通用 -->
    <section class="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <h3 class="text-sm font-medium text-secondary">通用</h3>

      <label class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3">
        <div>
          <div class="text-sm text-primary">节奏切换通知</div>
          <div class="text-xs text-tertiary">每次进入新时间块时发送系统通知（含块备注）</div>
        </div>
        <input v-model="working.notifications" type="checkbox" class="h-5 w-5" />
      </label>

      <label class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3">
        <div>
          <div class="text-sm text-primary">块结束预告</div>
          <div class="text-xs text-tertiary">
            专注类提前 5 分钟收尾预告 · 摸鱼类提前 2 分钟收敛预告（每块只提醒一次）
          </div>
        </div>
        <input v-model="working.endReminders" type="checkbox" class="h-5 w-5" />
      </label>

      <label class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3">
        <div>
          <div class="text-sm text-primary">开机自启</div>
          <div class="text-xs text-tertiary">登录后自动在托盘里跑起节奏</div>
        </div>
        <input v-model="working.autostart" type="checkbox" class="h-5 w-5" />
      </label>

      <label class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3">
        <div>
          <div class="text-sm text-primary">迷你悬浮窗</div>
          <div class="text-xs text-tertiary">常驻置顶小窗（快捷键 ⌘⇧B）</div>
        </div>
        <input v-model="working.mini.visible" type="checkbox" class="h-5 w-5" />
      </label>

      <label
        class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3 transition"
        :class="working.mini.visible ? '' : 'opacity-40'"
      >
        <div>
          <div class="text-sm text-primary">迷你窗跨桌面常驻</div>
          <div class="text-xs text-tertiary">切换桌面或全屏应用时，迷你窗仍然跟随显示</div>
        </div>
        <input
          v-model="working.mini.alwaysVisible"
          type="checkbox"
          class="h-5 w-5"
          :disabled="!working.mini.visible"
        />
      </label>

      <div class="flex items-center justify-between rounded-xl bg-base-deep/30 px-4 py-3">
        <div>
          <div class="text-sm text-primary">全局快捷键</div>
          <div class="text-xs text-tertiary">
            主窗 ⌘⇧M · 迷你窗 ⌘⇧B · 摸鱼掩护 ⌘⇧H（Windows 为 Ctrl⇧）
          </div>
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-3">
      <span v-if="saveError" class="text-xs text-danger">{{ saveError }}</span>
      <span v-else-if="dirty" class="text-xs text-warning">有未保存的更改</span>
      <button
        class="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-on-accent transition hover:opacity-90 disabled:opacity-40"
        :disabled="!dirty"
        @click="save"
      >
        保存设置
      </button>
    </div>

    <p class="pb-2 pt-4 text-center text-xs text-tertiary/70">
      Tempo Pulse <span v-if="appVersion">v{{ appVersion }}</span>
    </p>
  </div>
</template>
