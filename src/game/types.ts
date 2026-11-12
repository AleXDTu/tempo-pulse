/** 摸鱼小游戏：类型与常量。逻辑分辨率 480×270，瓦片基准 18px。 */

/** 逻辑画布宽（16:9，整数倍放大到 960×540） */
export const VIEW_W = 480;
/** 逻辑画布高：270 = 15 瓦片 */
export const VIEW_H = 270;
/** Kenney Pixel Platformer 瓦片边长 */
export const TILE = 18;
/** 更新频率（fixed timestep） */
export const FPS = 60;
export const STEP_MS = 1000 / FPS;
/** 一帧增量的钳制上限（后台回来不跳帧） */
export const MAX_FRAME_MS = 100;

/** 面朝方向：1 朝右，-1 朝左 */
export type Facing = 1 | -1;

/** 机枪角度档（度数，面朝半平面内；正数向上，y 轴向下为正所以发射时取负） */
export const AIM_ANGLES = [-90, -45, 0, 45, 90] as const;
/** AIM_ANGLES 里平射（0°）的下标，开局默认 */
export const AIM_DEFAULT_IDX = 2;

/** 敌人四类入场模式 */
export type EnemyKind = "crawler" | "flyer" | "dropper" | "rusher";

export interface Platform {
  /** 左边缘世界 x */
  x: number;
  /** 顶面 y */
  y: number;
  /** 瓦片数 */
  cols: number;
  active: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  active: boolean;
}

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** 存活帧数（驱动动画与正弦相位） */
  t: number;
  /** flyer 的正弦基准高度 */
  baseY: number;
  /** crawler 绑定的平台（贴着顶面走） */
  plat: Platform | null;
  active: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  active: boolean;
}

/** 前景装饰（天线 / 广告牌剪影，不参与碰撞） */
export interface Deco {
  kind: "antenna" | "billboard";
  x: number;
  active: boolean;
}

export type GamePhase = "playing" | "paused" | "gameover";

/** 窗口层与游戏逻辑层的全部接口约定：start(canvas) / destroy() 之外不外漏 */
export interface GameHandle {
  destroy(): void;
}
