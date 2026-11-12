/** 实体与对象池：子弹、敌人、粒子、平台、前景装饰。
 * 池子预分配，帧循环里只做激活/回收，不产生 GC 压力。
 */

import {
  AIM_ANGLES,
  TILE,
  VIEW_H,
  VIEW_W,
  type Bullet,
  type Enemy,
  type EnemyKind,
  type Facing,
  type Particle,
  type Platform,
} from "./types";

/** 通用对象池：预分配 + 腾出空闲位 */
export class Pool<T extends { active: boolean }> {
  readonly items: T[] = [];
  constructor(make: () => T, size: number) {
    for (let i = 0; i < size; i++) this.items.push(make());
  }


  /** 取一个空闲位（池满返回 null：宁可少生成也不扩池） */
  obtain(): T | null {
    for (const it of this.items) {
      if (!it.active) return it;
    }
    return null;
  }

  clear() {
    for (const it of this.items) it.active = false;
  }
}

export function makeBulletPool(size = 40): Pool<Bullet> {
  return new Pool<Bullet>(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false }), size);
}

export function makeEnemyPool(size = 24): Pool<Enemy> {
  return new Pool<Enemy>(
    () => ({
      kind: "crawler" as const,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      hp: 1,
      t: 0,
      baseY: 0,
      plat: null,
      active: false,
    }),
    size,
  );
}

export function makeParticlePool(size = 120): Pool<Particle> {
  return new Pool<Particle>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: "#fff", size: 2, active: false }),
    size,
  );
}

export function makePlatformPool(size = 10): Pool<Platform> {
  return new Pool<Platform>(() => ({ x: 0, y: 0, cols: 0, active: false }), size);
}


/** 主角碰撞盒（x 固定屏幕宽 1/3 处） */
export const HERO_X = Math.round(VIEW_W / 3);
export const HERO_W = 14;
export const HERO_H = 18;

/** 敌人参数表：速度为相对世界的额外量（爬行/飞行），px/帧 */
const ENEMY_DEFS: Record<
  EnemyKind,
  { hp: number; speed: number; w: number; h: number; score: number }
> = {
  crawler: { hp: 1, speed: 0.5, w: 16, h: 16, score: 100 },
  flyer: { hp: 2, speed: 0.8, w: 18, h: 18, score: 150 },
  dropper: { hp: 1, speed: 1.3, w: 14, h: 14, score: 120 },
  rusher: { hp: 2, speed: 3.1, w: 20, h: 12, score: 200 },
};

export function enemyDef(kind: EnemyKind) {
  return ENEMY_DEFS[kind];
}

export function enemyHitbox(e: Enemy): { x: number; y: number; w: number; h: number } {
  const d = ENEMY_DEFS[e.kind];
  return { x: e.x - d.w / 2, y: e.y - d.h / 2, w: d.w, h: d.h };
}
/** 生成敌人。dropper 在主角上方空降；其余三类按调用方给的入场侧生成 */
export function spawnEnemy(
  pool: Pool<Enemy>,
  kind: EnemyKind,
  x: number,
  y: number,
): Enemy | null {
  const e = pool.obtain();
  if (!e) return null;
  const d = ENEMY_DEFS[kind];
  e.kind = kind;
  e.x = x;
  e.y = y;
  e.hp = d.hp;
  e.t = 0;
  e.baseY = y;
  e.plat = null;
  e.vx = kind === "rusher" ? d.speed : -d.speed;
  e.vy = kind === "dropper" ? d.speed : 0;
  e.active = true;
  return e;
}

/** 主角开火：按当前角度档与面朝方向算弹道 */
export function spawnBullet(
  pool: Pool<Bullet>,
  x: number,
  y: number,
  aimIdx: number,
  facing: Facing,
  speed = 5.2,
  life = 55,
): Bullet | null {
  const b = pool.obtain();
  if (!b) return null;
  const rad = (AIM_ANGLES[aimIdx] * Math.PI) / 180;
  b.x = x;
  b.y = y;
  b.vx = Math.cos(rad) * speed * facing;
  b.vy = -Math.sin(rad) * speed;
  b.life = life;
  b.active = true;
  return b;
}

/** 爆炸粒子：碎片朝四周散开 */
export function spawnBurst(
  pool: Pool<Particle>,
  x: number,
  y: number,
  colors: string[],
  count = 8,
) {
  for (let i = 0; i < count; i++) {
    const p = pool.obtain();
    if (!p) return;
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.5 + Math.random() * 1.8;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp - 0.6;
    p.maxLife = 22 + Math.random() * 18;
    p.life = p.maxLife;
    p.color = colors[(Math.random() * colors.length) | 0];
    p.size = 1 + ((Math.random() * 2) | 0);
    p.active = true;
  }
}

/** 走路/落地扬尘 */
export function spawnDust(pool: Pool<Particle>, x: number, y: number) {
  const p = pool.obtain();
  if (!p) return;
  p.x = x + (Math.random() - 0.5) * 6;
  p.y = y;
  p.vx = -0.3 - Math.random() * 0.4;
  p.vy = -0.2 - Math.random() * 0.3;
  p.maxLife = 14;
  p.life = p.maxLife;
  p.color = "rgba(180,190,210,0.7)";
  p.size = 1;
  p.active = true;
}

/** 生成一段屋顶平台（cols 瓦片宽，顶面 y 像素） */
export function spawnPlatform(pool: Pool<Platform>, x: number, y: number, cols: number): Platform | null {
  const p = pool.obtain();
  if (!p) return null;
  p.x = x;
  p.y = y;
  p.cols = cols;
  p.active = true;
  return p;
}


/** 主角能踩到的最低平台顶面（掉出屏幕判定用） */
export const BOTTOM_Y = VIEW_H + TILE;
