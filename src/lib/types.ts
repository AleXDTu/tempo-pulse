// 与 src-tauri/src/model.rs 一一对应（serde camelCase）
// 若修改任一侧，需同步另一侧

export type StateKind = "focus" | "rest" | "slack" | "custom";

export interface PulseState {
  id: string;
  label: string;
  emoji: string | null;
  color: string;
  kind: StateKind;
}

export interface TimeBlock {
  id: string;
  /** "HH:MM"，墙钟时间 */
  start: string;
  /** "HH:MM"，必须大于 start */
  end: string;
  stateId: string;
  note: string | null;
}

export interface Schedule {
  id: string;
  name: string;
  blocks: TimeBlock[];
  /** 生效日，1=周一 … 7=周日 */
  activeDays: number[];
}

export interface MiniSettings {
  x: number | null;
  y: number | null;
  visible: boolean;
  /** 跨桌面常驻：切换 Space / 全屏应用时仍然可见（与 Rust 侧同步） */
  alwaysVisible: boolean;
}

export type RestBgType = "color" | "gradient" | "image";
export type RestStrictness = "skippable" | "postpone-once" | "locked";
export type RestMode = "fullscreen" | "window";

export interface RestScreenSettings {
  mode: RestMode;
  bgType: RestBgType;
  /** color: "#RRGGBB" / gradient: CSS gradient 字符串 / image: 资产路径 */
  bgValue: string;
  title: string;
  subtitle: string;
  strictness: RestStrictness;
}

/** 法定工作日数据，日期格式 "YYYY-MM-DD"；与 Rust 侧同步 */
export interface LegalDaysSettings {
  enabled: boolean;
  /** 法定节假日（放假日） */
  holidays: string[];
  /** 调休补班日（上班日） */
  workdays: string[];
}

export interface Settings {
  mini: MiniSettings;
  restScreen: RestScreenSettings;
  legalDays: LegalDaysSettings;
  /** 节奏总开关；停止时不计时、不提醒（与 Rust 侧同步） */
  running: boolean;
  /** 是否完成过新手引导 */
  onboarded: boolean;
  autostart: boolean;
  notifications: boolean;
}

export interface AppConfig {
  states: PulseState[];
  schedules: Schedule[];
  settings: Settings;
}

/** 引擎每秒推送的快照，也是 transition 事件的载荷 */
export interface PulseSnapshot {
  /** 当前状态（被跳过或空隙期为 null） */
  state: PulseState | null;
  blockNote: string | null;
  blockId: string | null;
  remainingSecs: number;
  /** 当前块已进行比例 0~1 */
  progress: number;
  /** 下一个切换点 "HH:MM" */
  nextAt: string | null;
  nextStateLabel: string | null;
  /** 当前生效的时间表名 */
  scheduleName: string | null;
  /** "HH:MM:SS" 引擎时钟 */
  now: string;
  isIdle: boolean;
  /** 总开关；false 时其余字段清零（已停止） */
  running: boolean;
}

export interface TransitionPayload {
  from: PulseState | null;
  to: PulseSnapshot;
}
