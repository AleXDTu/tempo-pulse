/** 渲染层：六层视差夜景 + 实体 + HUD + 菜单。
 * 背景全部程序化生成（seed 可换）：夜空渐变、星星、月亮、云、两层城市楼群剪影；
 * 屋顶平台用 Kenney 瓦片（assets.ts 已做夜色处理）；前景装饰为剪影。
 */

import type { GameSprites, HeroState } from "./assets";
import {
  enemyDef,
  enemyHitbox,
  HERO_X,
  Pool,
} from "./entities";
import {
  AIM_ANGLES,
  TILE,
  VIEW_H,
  VIEW_W,
  type Bullet,
  type Deco,
  type Enemy,
  type Facing,
  type GamePhase,
  type Particle,
  type Platform,
} from "./types";

/** 渲染层要读的全部游戏状态（index.ts 的 Game 实现） */
export interface GameView {
  phase: GamePhase;
  frame: number;
  score: number;
  hp: number;
  best: number;
  /** 无敌帧剩余 */
  invuln: number;
  aimIdx: number;
  facing: Facing;
  muted: boolean;
  platforms: Pool<Platform>;
  bullets: Pool<Bullet>;
  enemies: Pool<Enemy>;
  particles: Pool<Particle>;
  /** 主角脚底 y（世界坐标即屏幕坐标，x 固定） */
  heroY: number;
  onGround: boolean;
  heroState: HeroState;
  /** 本帧是否画主角（无敌帧闪烁由逻辑层决定） */
  heroVisible: boolean;
  /** 枪口闪光剩余帧 */
  muzzle: number;
}

interface Star {
  x: number;
  y: number;
  phase: number;
  color: string;
}

interface Cloud {
  x: number;
  y: number;
  puffs: { dx: number; dy: number; r: number }[];
}

interface Building {
  x: number;
  w: number;
  h: number;
  /** 亮窗下标集合（窗口网格按行优先编码） */
  wins: Set<number>;
  antenna: boolean;
}

/** 两层楼群的生成参数（远景更矮更稀，近景更高更密、亮窗更多） */
interface SkylineOpts {
  wMin: number;
  wMax: number;
  hMin: number;
  hMax: number;
  lit: number;
}

const FAR_BASE = 210;
const NEAR_BASE = 234;
const FAR_OPTS: SkylineOpts = { wMin: 22, wMax: 46, hMin: 55, hMax: 125, lit: 0.16 };
const NEAR_OPTS: SkylineOpts = { wMin: 30, wMax: 64, hMin: 70, hMax: 150, lit: 0.28 };

export interface MenuButton {
  label: string;
  action: "resume" | "restart" | "exit";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 敌人四类的染色（Kenney 方块素材统一形状，颜色区分种类） */
const ENEMY_TINT: Record<Enemy["kind"], string> = {
  crawler: "#b8bb26",
  flyer: "#83a598",
  dropper: "#fabd2f",
  rusher: "#fb4934",
};

const STAR_COLORS = ["#d5cfa1", "#ebdbb2", "#83a598", "#b8bb26"];

/** 程序化主角的像素点阵：14×18（撞盒同尺寸），朝右画、反向时整图镜像。
 * 字符：R 红头带（含飘带）S 皮肤/浅色衣 E 眼 K 腰带/军靴 . 透明。
 * 上半身 12 行共用，差异在腿部；跳跃收腿，跑步跨步与并腿交替。
 */
const HERO_BODY_ROWS = [
  "....RRRRR.....",
  ".R..RRRRR.....",
  ".RR.SSSSES....",
  ".RR.SSSSS.....",
  ".....SSS......",
  "....SSSSS.....",
  "...SSSSSSS....",
  "...SSSSSS.....",
  "...SSSSSSSSS..",
  "...SSSSSS.....",
  "...SSSSSS.....",
  "...KKKKKK.....",
];

/** 站立/跑步并腿帧（腿部 6 行） */
const HERO_STAND_ROWS = [
  "....SS.SS.....",
  "....SS.SS.....",
  "....SS.SS.....",
  "....SS.SS.....",
  "....SS.SS.....",
  "....KK.KK.....",
];

/** 跑步跨步帧：前腿迈出到落地、后腿抬起 */
const HERO_STRIDE_ROWS = [
  "....SSSSS.....",
  "....SS..SS....",
  "...SS....SS...",
  "...SS.....SS..",
  "...KK.....SS..",
  "..........KK..",
];

/** 跳跃收腿帧 */
const HERO_TUCK_ROWS = [
  "...SSSSSS.....",
  "...SS..SS.....",
  "...KK..KK.....",
  "..............",
  "..............",
  "..............",
];

/** mulberry32：可换 seed 的确定性伪随机 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  private stars: Star[] = [];
  private moonX = 390;
  private clouds: Cloud[] = [];
  private far: Building[] = [];
  private near: Building[] = [];
  private decos: { kind: Deco["kind"]; x: number; h: number }[] = [];
  private farOffset = 0;
  private nearOffset = 0;
  private decoOffset = 0;
  private rng: () => number;
  private sky: HTMLCanvasElement;
  private tintCache = new Map<string, HTMLCanvasElement>();
  /** 本帧菜单按钮的命中区（drawMenu 时刷新） */
  menuButtons: MenuButton[] = [];

  constructor(
    private sprites: GameSprites,
    seed: number,
  ) {
    this.rng = mulberry32(seed);
    this.sky = this.makeSky();
    this.makeStars();
    this.makeClouds();
    this.fillSkyline(this.far, 0, FAR_OPTS);
    this.fillSkyline(this.near, 0, NEAR_OPTS);
    this.fillDecos();
  }

  private makeSky(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = VIEW_W;
    c.height = VIEW_H;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "#101223");
    g.addColorStop(0.55, "#1e2033");
    g.addColorStop(1, "#34304b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    return c;
  }

  private makeStars() {
    const rng = this.rng;
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: rng() * VIEW_W,
        y: rng() * VIEW_H * 0.66,
        phase: rng() * Math.PI * 2,
        color: STAR_COLORS[(rng() * STAR_COLORS.length) | 0],
      });
    }
  }

  private makeClouds() {
    const rng = this.rng;
    for (let i = 0; i < 6; i++) {
      const puffs = [];
      const n = 3 + ((rng() * 3) | 0);
      for (let j = 0; j < n; j++) {
        puffs.push({ dx: j * 14 - n * 7, dy: (rng() - 0.5) * 6, r: 9 + rng() * 8 });
      }
      this.clouds.push({ x: rng() * 620, y: 26 + rng() * 90, puffs });
    }
  }


  private fillSkyline(list: Building[], offset: number, o: SkylineOpts) {
    const rng = this.rng;
    let cursor = list.length
      ? list[list.length - 1].x + list[list.length - 1].w + 3
      : offset - 30;
    while (cursor - offset < VIEW_W + 60) {
      const w = o.wMin + ((rng() * (o.wMax - o.wMin)) | 0);
      const h = o.hMin + ((rng() * (o.hMax - o.hMin)) | 0);
      const wins = new Set<number>();
      const cols = Math.max(1, ((w - 6) / 5) | 0);
      const rows = Math.max(1, ((h - 8) / 6) | 0);
      for (let i = 0; i < cols * rows; i++) {
        if (rng() < o.lit) wins.add(i);
      }
      list.push({ x: cursor, w, h, wins, antenna: rng() < 0.18 });
      cursor += w + 2 + ((rng() * 10) | 0);
    }
  }

  private fillDecos() {
    const rng = this.rng;
    let cursor = 200;
    while (cursor < VIEW_W + 120) {
      if (rng() < 0.55) {
        this.decos.push({
          kind: rng() < 0.6 ? "antenna" : "billboard",
          x: cursor,
          h: 26 + ((rng() * 22) | 0),
        });
      }
      cursor += 90 + ((rng() * 160) | 0);
    }
    this.decoCursor = cursor;
  }

  private decoCursor = 0;

  /** 每个逻辑帧推进各视差层（数值在 update 里推进保证确定性） */
  advance(scroll: number) {
    this.farOffset += scroll * 0.1;
    this.nearOffset += scroll * 0.3;
    this.decoOffset += scroll * 1.25;
    this.moonX -= scroll * 0.012;
    if (this.moonX < -30) this.moonX = VIEW_W + 30;

    // 回收左端、补右端
    while (this.far.length && this.far[0].x + this.far[0].w - this.farOffset < -40) this.far.shift();
    this.fillSkyline(this.far, this.farOffset, FAR_OPTS);
    while (this.near.length && this.near[0].x + this.near[0].w - this.nearOffset < -40) this.near.shift();
    this.fillSkyline(this.near, this.nearOffset, NEAR_OPTS);

    while (this.decos.length && this.decos[0].x - this.decoOffset < -60) this.decos.shift();
    while (this.decoCursor - this.decoOffset < VIEW_W + 80) {
      if (this.rng() < 0.55) {
        this.decos.push({
          kind: this.rng() < 0.6 ? "antenna" : "billboard",
          x: this.decoCursor,
          h: 26 + ((this.rng() * 22) | 0),
        });
      }
      this.decoCursor += 90 + ((this.rng() * 160) | 0);
    }
  }

  /** 方块素材染色（multiply 混合，保留暗部描边），结果缓存 */
  private tinted(color: string): HTMLCanvasElement {
    let c = this.tintCache.get(color);
    if (c) return c;
    const img = this.sprites.block;
    c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, 0, 0);
    this.tintCache.set(color, c);
    return c;
  }

  render(ctx: CanvasRenderingContext2D, g: GameView) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sky, 0, 0);

    // 1. 星星（极慢视差 + 闪烁）
    const starOff = g.frame * 0.02;
    for (const s of this.stars) {
      const sx = (((s.x - starOff) % VIEW_W) + VIEW_W) % VIEW_W;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(s.phase + g.frame * 0.02));
      ctx.globalAlpha = tw;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(sx), Math.round(s.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    // 2. 远月（极缓慢漂移层）：小盘贴着画面上缘，压暗的米色不抢夜景
    const mx = Math.round(this.moonX);
    const my = 34;
    // 暗色月晕：比夜空亮一档的冷紫灰，两层向外晕开
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#3f3d58";
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(mx, my, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 月盘 + 环形山（都收在盘内）
    ctx.fillStyle = "#c6bda0";
    ctx.beginPath();
    ctx.arc(mx, my, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#aea67f";
    ctx.beginPath();
    ctx.arc(mx - 4, my - 5, 2.5, 0, Math.PI * 2);
    ctx.arc(mx + 6, my + 2, 3.5, 0, Math.PI * 2);
    ctx.arc(mx - 2, my + 8, 2, 0, Math.PI * 2);
    ctx.fill();

    // 3. 云层（慢）
    ctx.fillStyle = "rgba(38,42,61,0.85)";
    for (const c of this.clouds) {
      const sx = (((c.x - this.nearOffset * 0.2) % 620) + 620) % 620 - 70;
      for (const p of c.puffs) {
        ctx.beginPath();
        ctx.ellipse(
          Math.round(sx + p.dx),
          Math.round(c.y + p.dy),
          p.r,
          p.r * 0.45,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // 4. 远景楼群剪影（更慢）
    this.drawSkyline(ctx, this.far, this.farOffset, FAR_BASE, "#232534", "#c99d4a", false, g.frame);

    // 5. 近景楼群剪影 + 亮窗（中速）
    this.drawSkyline(ctx, this.near, this.nearOffset, NEAR_BASE, "#2c2e3e", "#fabd2f", true, g.frame);

    // 6. 屋顶平台（游戏速度，Kenney 瓦片）
    for (const p of g.platforms.items) {
      if (!p.active) continue;
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      for (let i = 0; i < p.cols; i++) {
        const src = i === 0 ? this.sprites.tileLeft : i === p.cols - 1 ? this.sprites.tileRight : this.sprites.tileMid;
        ctx.drawImage(src, px + i * TILE, py);
      }
    }

    // 7. 粒子（在实体后面，尘土/碎片）
    for (const p of g.particles.items) {
      if (!p.active) continue;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // 8. 敌人
    for (const e of g.enemies.items) {
      if (!e.active) continue;
      const box = enemyHitbox(e);
      const src = this.tinted(ENEMY_TINT[e.kind]);
      ctx.save();
      ctx.translate(Math.round(box.x + box.w / 2), Math.round(box.y + box.h / 2));
      if (e.kind === "dropper") ctx.rotate(e.t * 0.08);
      if (e.kind === "rusher") ctx.scale(-1, 1); // 突袭从左往右冲，头朝右
      const d = enemyDef(e.kind);
      ctx.drawImage(src, -d.w / 2, -d.h / 2, d.w, d.h);
      ctx.restore();
      // flyer 喷尾
      if (e.kind === "flyer" && g.frame % 4 < 2) {
        ctx.fillStyle = "rgba(131,165,152,0.5)";
        ctx.fillRect(Math.round(box.x + box.w), Math.round(e.y - 1), 4, 2);
      }
    }

    // 9. 子弹（按弹道旋转）
    for (const b of g.bullets.items) {
      if (!b.active) continue;
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
      ctx.drawImage(this.sprites.bullet, -3, -8, 6, 16);
      ctx.restore();
    }

    // 10. 主角：用户状态图优先，缺省画程序化像素小人（高对比、看得出朝向）
    if (g.heroVisible) {
      const spr = this.sprites.hero[g.heroState];
      ctx.save();
      ctx.translate(HERO_X, Math.round(g.heroY));
      ctx.scale(g.facing, 1);
      if (spr) {
        ctx.drawImage(spr, -12, -22, 24, 24);
      } else {
        this.drawHero(ctx, g.heroState, g.frame);
      }
      ctx.restore();
      // 枪（面朝方向的小机枪，提亮保证夜色里可见）
      const gy = Math.round(g.heroY) - 10;
      const aim = (AIM_ANGLES[g.aimIdx] * Math.PI) / 180;
      const gunLen = 11;
      const gx2 = gunLen * Math.cos(aim) * g.facing;
      const gy2 = -gunLen * Math.sin(aim);
      ctx.strokeStyle = "#bdae93";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(HERO_X, gy);
      ctx.lineTo(HERO_X + gx2, gy + gy2);
      ctx.stroke();
      if (g.muzzle > 0) {
        ctx.fillStyle = "#fabd2f";
        ctx.beginPath();
        ctx.arc(HERO_X + gx2 + g.facing * 2, gy + gy2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 11. 前景装饰剪影（略快于平台）
    ctx.fillStyle = "rgba(12,12,18,0.9)";
    for (const d of this.decos) {
      const sx = Math.round(d.x - this.decoOffset);
      if (sx < -60 || sx > VIEW_W + 60) continue;
      if (d.kind === "antenna") {
        ctx.fillRect(sx, VIEW_H - 14 - d.h, 2, d.h);
        for (let i = 1; i <= 2; i++) {
          ctx.fillRect(sx - 4, VIEW_H - 14 - d.h + i * 7, 10, 1);
        }
        if (g.frame % 40 < 20) {
          ctx.fillStyle = "#fb4934";
          ctx.fillRect(sx, VIEW_H - 17 - d.h, 2, 2);
          ctx.fillStyle = "rgba(12,12,18,0.9)";
        }
      } else {
        ctx.fillRect(sx - 22, VIEW_H - 14 - d.h, 44, d.h - 10);
        ctx.fillRect(sx - 18, VIEW_H - 24 - d.h + 6, 3, 14);
        ctx.fillRect(sx + 15, VIEW_H - 24 - d.h + 6, 3, 14);
      }
    }

    // 12. HUD 与菜单
    this.drawHud(ctx, g);
    if (g.phase !== "playing") this.drawMenu(ctx, g);
  }

  private drawSkyline(
    ctx: CanvasRenderingContext2D,
    list: Building[],
    offset: number,
    base: number,
    bodyColor: string,
    winColor: string,
    blink: boolean,
    frame: number,
  ) {
    for (const b of list) {
      const sx = Math.round(b.x - offset);
      if (sx > VIEW_W + 40 || sx + b.w < -40) continue;
      const top = base - b.h;
      ctx.fillStyle = bodyColor;
      ctx.fillRect(sx, top, b.w, b.h);
      // 亮窗点阵
      const cols = Math.max(1, ((b.w - 6) / 5) | 0);
      // 行数无需重算：亮窗下标按生成时的网格编码，解码只用列数
      ctx.fillStyle = winColor;
      for (const idx of b.wins) {
        const cx = idx % cols;
        const cy = (idx / cols) | 0;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(sx + 3 + cx * 5, top + 4 + cy * 6, 2, 3);
      }
      ctx.globalAlpha = 1;
      // 近景楼顶天线 + 红色航空灯
      if (b.antenna) {
        ctx.fillStyle = bodyColor;
        ctx.fillRect(sx + ((b.w / 2) | 0), top - 12, 2, 12);
        if (blink && frame % 50 < 25) {
          ctx.fillStyle = "#fb4934";
          ctx.fillRect(sx + ((b.w / 2) | 0), top - 14, 2, 2);
        }
      }
    }
  }

  /** 程序化主角：按状态拼点阵逐像素画（受击整体换红色调），朝向由外层 scale 镜像 */
  private drawHero(ctx: CanvasRenderingContext2D, state: HeroState, frame: number) {
    const legs =
      state === "jump"
        ? HERO_TUCK_ROWS
        : state === "run" || state === "shoot"
          ? (((frame / 6) | 0) % 2 ? HERO_STRIDE_ROWS : HERO_STAND_ROWS)
          : HERO_STAND_ROWS;
    const hurt = state === "hurt";
    const colors: Record<string, string> = hurt
      ? { R: "#ebdbb2", S: "#fb4934", E: "#1d1d2b", K: "#9d0006" }
      : { R: "#fb4934", S: "#ebdbb2", E: "#1d1d2b", K: "#665c54" };
    for (let r = 0; r < 18; r++) {
      const row = r < 12 ? HERO_BODY_ROWS[r] : legs[r - 12];
      for (let c = 0; c < 14; c++) {
        const ch = row[c];
        if (ch === ".") continue;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(c - 7, r - 18, 1, 1);
      }
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, g: GameView) {
    ctx.font = "bold 9px monospace";
    ctx.textBaseline = "top";
    // 血量（左上）：像素心（两格顶 + 倒三角身），不用文字符号（各平台字形不稳）
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < g.hp ? "#fb4934" : "#3c3a4a";
      const hx = 8 + i * 12;
      const hy = 8;
      ctx.fillRect(hx, hy, 3, 2);
      ctx.fillRect(hx + 5, hy, 3, 2);
      ctx.fillRect(hx, hy + 2, 8, 3);
      ctx.fillRect(hx + 1, hy + 5, 6, 1);
      ctx.fillRect(hx + 2, hy + 6, 4, 1);
      ctx.fillRect(hx + 3, hy + 7, 2, 1);
    }
    // 分数（右上）
    ctx.fillStyle = "#ebdbb2";
    ctx.textAlign = "right";
    ctx.fillText(`${g.score}`, VIEW_W - 8, 8);
    ctx.textAlign = "left";
    // 角度拨盘（左下）：面朝半平面 5 档，当前档高亮
    const cx = 26;
    const cy = VIEW_H - 24;
    const r = 11;
    for (let i = 0; i < AIM_ANGLES.length; i++) {
      const a = (AIM_ANGLES[i] * Math.PI) / 180;
      const tx = cx + Math.cos(a) * r * g.facing;
      const ty = cy - Math.sin(a) * r;
      ctx.fillStyle = i === g.aimIdx ? "#fabd2f" : "#665c54";
      const size = i === g.aimIdx ? 3 : 2;
      ctx.fillRect(Math.round(tx) - (size >> 1), Math.round(ty) - (size >> 1), size, size);
    }
    ctx.fillStyle = "#ebdbb2";
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    // 面朝方向：小三角
    ctx.beginPath();
    if (g.facing === 1) {
      ctx.moveTo(cx + r + 5, cy - 3);
      ctx.lineTo(cx + r + 5, cy + 3);
      ctx.lineTo(cx + r + 10, cy);
    } else {
      ctx.moveTo(cx - r - 5, cy - 3);
      ctx.lineTo(cx - r - 5, cy + 3);
      ctx.lineTo(cx - r - 10, cy);
    }
    ctx.fill();
    // 静音状态（右下）
    ctx.fillStyle = "#665c54";
    ctx.fillText(`音效 M:${g.muted ? "关" : "开"}`, VIEW_W - 70, VIEW_H - 16);
  }

  private drawMenu(ctx: CanvasRenderingContext2D, g: GameView) {
    ctx.fillStyle = "rgba(16,18,35,0.78)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.menuButtons = [];
    if (g.phase === "paused") {
      ctx.fillStyle = "#ebdbb2";
      ctx.font = "bold 16px monospace";
      ctx.fillText("已暂停", VIEW_W / 2, 92);
      ctx.font = "9px monospace";
      ctx.fillStyle = "#a89984";
      ctx.fillText("窗口失焦会自动暂停，回来后手动继续", VIEW_W / 2, 112);
      this.addButton(ctx, "继续 (Esc)", "resume", 108);
      this.addButton(ctx, "重开 (R)", "restart", 136);
      this.addButton(ctx, "退出 (Q)", "exit", 164);
    } else {
      ctx.fillStyle = "#fb4934";
      ctx.font = "bold 18px monospace";
      ctx.fillText("本局结束", VIEW_W / 2, 78);
      ctx.fillStyle = "#ebdbb2";
      ctx.font = "bold 11px monospace";
      ctx.fillText(`分数 ${g.score}`, VIEW_W / 2, 106);
      ctx.font = "9px monospace";
      ctx.fillStyle = "#fabd2f";
      ctx.fillText(`最高纪录 ${g.best}`, VIEW_W / 2, 124);
      this.addButton(ctx, "重开 (Enter)", "restart", 150);
      this.addButton(ctx, "退出 (Q)", "exit", 178);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }

  private addButton(
    ctx: CanvasRenderingContext2D,
    label: string,
    action: MenuButton["action"],
    y: number,
  ) {
    const w = 120;
    const h = 20;
    const x = (VIEW_W - w) / 2;
    ctx.fillStyle = "#2c2e3e";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#665c54";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#ebdbb2";
    ctx.font = "9px monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(label, VIEW_W / 2, y + h / 2 + 0.5);
    this.menuButtons.push({ label, action, x, y, w, h });
  }

  /** 逻辑坐标命中菜单按钮（点击事件换算后调用） */
  hitButton(lx: number, ly: number): MenuButton["action"] | null {
    for (const b of this.menuButtons) {
      if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return b.action;
    }
    return null;
  }
}
