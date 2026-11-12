/** 游戏主体：fixed timestep 60Hz 更新 + rAF 渲染、输入、碰撞、生成、状态机。
 * 窗口层只认 startGame(canvas) 返回的 start/destroy 约定（见 types.ts GameHandle）。
 */

import { loadGameAssets, type GameSprites, type HeroState } from "./assets";
import { GameAudio } from "./audio";
import {
  BOTTOM_Y,
  HERO_H,
  HERO_W,
  enemyHitbox,
  HERO_X,
  enemyDef,
  makeBulletPool,
  makeEnemyPool,
  makeParticlePool,
  makePlatformPool,
  spawnBullet,
  spawnBurst,
  spawnDust,
  spawnEnemy,
  spawnPlatform,
} from "./entities";
import { Renderer, type GameView } from "./render";
import {
  AIM_ANGLES,
  AIM_DEFAULT_IDX,
  MAX_FRAME_MS,
  STEP_MS,
  TILE,
  VIEW_H,
  VIEW_W,
  type Facing,
  type GameHandle,
  type GamePhase,
  type Platform,
} from "./types";

export type { GameHandle } from "./types";

/** 最高分存 localStorage（WebView profile 持久，等同「本次安装内」） */
const BEST_KEY = "tempo-pulse.game.best";

/** 平台顶面允许的瓦片行档（6 行高 ～ 13 行低） */
const ROW_MIN = 6;
const ROW_MAX = 13;

const GRAVITY = 0.35;
const JUMP_VY = -6.4;
const MAX_FALL = 7;
const SHOOT_COOLDOWN = 7;
const INVULN_FRAMES = 90;
const BULLET_SPEED = 5.2;

export interface GameOptions {
  /** 玩家从菜单主动退出（窗口层负责关窗） */
  onExit(): void;
}

class Game implements GameView {
  phase: GamePhase = "playing";
  frame = 0;
  score = 0;
  hp = 3;
  best = 0;
  invuln = 0;
  aimIdx = AIM_DEFAULT_IDX;
  facing: Facing = 1;
  muted = false;
  platforms = makePlatformPool();
  bullets = makeBulletPool();
  enemies = makeEnemyPool();
  particles = makeParticlePool();
  heroY = 12 * TILE;
  onGround = true;
  heroState: HeroState = "run";
  heroVisible = true;
  muzzle = 0;

  private heroVy = 0;
  private scroll = 1.15;
  private shootTimer = 0;
  private hurtTimer = 0;
  private enemyTimer = 90;
  private coyote = 0;
  private keys = new Set<string>();
  private renderer!: Renderer;
  private sprites!: GameSprites;
  private audio = new GameAudio();
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private lastTime = 0;
  private acc = 0;
  private destroyed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: GameOptions,
  ) {
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx = this.canvas.getContext("2d")!;
    const saved = Number(localStorage.getItem(BEST_KEY));
    this.best = Number.isFinite(saved) && saved > 0 ? saved : 0;
    this.resetWorld();
    void this.boot();
  }

  private async boot() {
    this.sprites = await loadGameAssets();
    this.renderer = new Renderer(this.sprites, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    void this.audio.loadBgm();
    this.attachInput();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** 世界复位（首局与重开共用）：起始整幅长平台保证站稳 */
  private resetWorld() {
    this.platforms.clear();
    this.bullets.clear();
    this.enemies.clear();
    this.particles.clear();
    this.score = 0;
    this.hp = 3;
    this.frame = 0;
    this.scroll = 1.15;
    this.invuln = 120;
    this.aimIdx = AIM_DEFAULT_IDX;
    this.facing = 1;
    this.heroY = 12 * TILE;
    this.heroVy = 0;
    this.onGround = true;
    this.enemyTimer = 90;
    this.hurtTimer = 0;
    this.muzzle = 0;
    spawnPlatform(this.platforms, -30, 12 * TILE, 34);
    this.renderer?.advance(0);
  }

  restart() {
    this.renderer = new Renderer(this.sprites, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.resetWorld();
    this.phase = "playing";
    this.audio.unlock();
  }

  // ---- 输入 ----

  private attachInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("click", this.onClick);
  }

  private detachInput() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("click", this.onClick);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.audio.unlock();
    const codes = [
      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
      "KeyA", "KeyD", "KeyW", "KeyS", "Space", "KeyJ", "KeyX",
    ];
    if (codes.includes(e.code)) e.preventDefault();

    if (e.code === "Escape") {
      if (this.phase === "playing") this.phase = "paused";
      else if (this.phase === "paused") this.phase = "playing";
      return;
    }
    if (this.phase === "gameover") {
      if (e.code === "Enter") this.restart();
      if (e.code === "KeyQ") this.opts.onExit();
      return;
    }
    if (this.phase === "paused") {
      if (e.code === "KeyR") this.restart();
      if (e.code === "KeyQ") this.opts.onExit();
      return;
    }
    if (e.repeat) {
      this.keys.add(e.code);
      return;
    }
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.facing = -1;
        break;
      case "ArrowRight":
      case "KeyD":
        this.facing = 1;
        break;
      case "ArrowUp":
      case "KeyW":
        this.aimIdx = (this.aimIdx + 1) % AIM_ANGLES.length;
        break;
      case "ArrowDown":
      case "KeyS":
        this.aimIdx = (this.aimIdx + AIM_ANGLES.length - 1) % AIM_ANGLES.length;
        break;
      case "Space":
        this.tryJump();
        break;
      case "KeyM":
        this.muted = !this.muted;
        this.audio.setMuted(this.muted);
        break;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** 窗口失焦自动暂停（回前台不自动继续，手动 Esc/继续） */
  private onBlur = () => {
    if (this.phase === "playing") this.phase = "paused";
    this.keys.clear();
  };

  private onClick = (e: MouseEvent) => {
    this.audio.unlock();
    if (this.phase === "playing") return;
    const rect = this.canvas.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const ly = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const action = this.renderer?.hitButton(lx, ly);
    if (action === "resume") this.phase = "playing";
    else if (action === "restart") this.restart();
    else if (action === "exit") this.opts.onExit();
  };

  private tryJump() {
    if (this.onGround || this.coyote > 0) {
      this.heroVy = JUMP_VY;
      this.onGround = false;
      this.coyote = 0;
      spawnDust(this.particles, HERO_X, this.heroY);
      this.audio.jump();
    }
  }

  // ---- 主循环 ----

  private loop = (now: number) => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.loop);
    let delta = now - this.lastTime;
    this.lastTime = now;
    if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS;
    this.acc += delta;
    while (this.acc >= STEP_MS) {
      this.step();
      this.acc -= STEP_MS;
    }
    this.renderer?.render(this.ctx, this);
  };

  private step() {
    this.frame++;
    if (this.phase !== "playing") return;
    this.updateWorld();
    this.updateHero();
    this.updateBullets();
    this.updateEnemies();
    this.collide();
    this.updateParticles();
    this.decideHeroVisual();
  }

  private updateWorld() {
    this.scroll = Math.min(2.4, 1.15 + this.frame * 0.0022);
    this.renderer.advance(this.scroll);

    for (const p of this.platforms.items) {
      if (p.active) p.x -= this.scroll;
    }
    // 回收完全出屏的平台
    for (const p of this.platforms.items) {
      if (p.active && p.x + p.cols * TILE < -20) p.active = false;
    }
    // 右端补新平台：高度差受跳跃能力约束（上跳最多 2 行，下落最多 3 行）
    let rightEdge = -Infinity;
    let lastRow = 12;
    for (const p of this.platforms.items) {
      if (!p.active) continue;
      const edge = p.x + p.cols * TILE;
      if (edge > rightEdge) {
        rightEdge = edge;
        lastRow = Math.round(p.y / TILE);
      }
    }
    if (rightEdge < VIEW_W + 30) {
      const dy = [-2, -1, -1, 0, 0, 1, 1, 2, 3][(Math.random() * 9) | 0];
      const row = Math.max(ROW_MIN, Math.min(ROW_MAX, lastRow + dy));
      const gap = dy < 0 ? (Math.random() * 2) | 0 : 1 + ((Math.random() * 3) | 0);
      const cols = 5 + ((Math.random() * 10) | 0);
      spawnPlatform(this.platforms, rightEdge + gap * TILE, row * TILE, cols);
    }
  }

  private platformUnder(feetY: number): Platform | null {
    // 单向踩踏：只有下落中、且上一帧脚在顶面之上才算落地
    let bestPlat: Platform | null = null;
    for (const p of this.platforms.items) {
      if (!p.active) continue;
      if (HERO_X < p.x || HERO_X > p.x + p.cols * TILE) continue;
      if (feetY >= p.y && (!bestPlat || p.y < bestPlat.y)) bestPlat = p;
    }
    return bestPlat;
  }

  private updateHero() {
    const prevFeet = this.heroY;
    // 贴地时跟着平台顶走；平台边缘走过就下落（留 6 帧土狼时间）
    if (this.onGround) {
      const ground = this.platformUnder(this.heroY + 1);
      if (ground && HERO_X >= ground.x - 2 && HERO_X <= ground.x + ground.cols * TILE + 2) {
        this.heroY = ground.y;
      } else {
        this.onGround = false;
        this.coyote = 6;
      }
    } else {
      this.heroVy = Math.min(MAX_FALL, this.heroVy + GRAVITY);
      this.heroY += this.heroVy;
      if (this.heroVy > 0) {
        const plat = this.platformUnder(this.heroY);
        if (plat && prevFeet <= plat.y + 0.01) {
          this.heroY = plat.y;
          this.heroVy = 0;
          this.onGround = true;
          spawnDust(this.particles, HERO_X, this.heroY);
        }
      }
      if (this.coyote > 0) this.coyote--;
    }

    // 掉出屏幕底部：扣血 + 最近平台重生
    if (this.heroY > BOTTOM_Y) {
      this.damage();
      if (this.phase === "playing") this.respawn();
    }

    // 射击（按住连发）
    if (this.shootTimer > 0) this.shootTimer--;
    if (this.muzzle > 0) this.muzzle--;
    if (this.keys.has("KeyJ") || this.keys.has("KeyX")) {
      if (this.shootTimer <= 0) {
        const gx = HERO_X + this.facing * 9;
        const gy = this.heroY - 10;
        if (spawnBullet(this.bullets, gx, gy, this.aimIdx, this.facing, BULLET_SPEED)) {
          this.shootTimer = SHOOT_COOLDOWN;
          this.muzzle = 4;
          this.audio.shoot();
        }
      }
    }

    if (this.invuln > 0) this.invuln--;
    if (this.hurtTimer > 0) this.hurtTimer--;
  }

  /** 掉落后重生：回到覆盖主角 x 的最低平台上方 */
  private respawn() {
    let target: Platform | null = null;
    for (const p of this.platforms.items) {
      if (!p.active) continue;
      if (HERO_X >= p.x - 2 && HERO_X <= p.x + p.cols * TILE + 2) {
        if (!target || p.y > target.y) target = p;
      }
    }
    if (!target) {
      // 脚下没有平台（都在间隙里）：取最靠近主角 x 的平台
      for (const p of this.platforms.items) {
        if (!p.active) continue;
        if (!target || Math.abs(p.x - HERO_X) < Math.abs(target.x - HERO_X)) target = p;
      }
    }
    if (!target) return;
    this.heroY = target.y - 46;
    this.heroVy = 0;
    this.onGround = false;
    this.invuln = INVULN_FRAMES;
  }

  private damage() {
    if (this.invuln > 0) return;
    this.hp--;
    this.invuln = INVULN_FRAMES;
    this.hurtTimer = 20;
    this.audio.hurt();
    spawnBurst(this.particles, HERO_X, this.heroY - 10, ["#fb4934", "#fabd2f"], 10);
    if (this.hp <= 0) {
      this.phase = "gameover";
      if (this.score > this.best) {
        this.best = this.score;
        localStorage.setItem(BEST_KEY, String(this.best));
      }
      this.audio.gameover();
    }
  }

  private updateBullets() {
    for (const b of this.bullets.items) {
      if (!b.active) continue;
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      if (b.life <= 0 || b.x < -10 || b.x > VIEW_W + 10 || b.y < -10 || b.y > VIEW_H + 10) {
        b.active = false;
      }
    }
  }

  private updateEnemies() {
    // 生成导演：间隔随时间缩短（约 1.6s → 0.55s），突袭敌 30 秒后入场
    this.enemyTimer--;
    if (this.enemyTimer <= 0) {
      const base = Math.max(33, 100 - this.frame * 0.03);
      this.enemyTimer = base * (0.7 + Math.random() * 0.6);
      this.spawnOneEnemy();
    }

    for (const e of this.enemies.items) {
      if (!e.active) continue;
      e.t++;
      switch (e.kind) {
        case "crawler": {
          const plat = e.plat;
          if (!plat || !plat.active) {
            e.active = false;
            break;
          }
          e.x -= this.scroll + 0.5;
          e.y = plat.y - enemyDef("crawler").h / 2;
          if (e.x < plat.x - 2 || e.x < -20) e.active = false;
          break;
        }
        case "flyer":
          e.x -= this.scroll + 0.8;
          e.y = e.baseY + Math.sin(e.t * 0.05) * 24;
          if (e.x < -30) e.active = false;
          break;
        case "dropper": {
          const prevY = e.y;
          e.y += e.vy;
          // 落到平台顶：砸地尘土后消失
          for (const p of this.platforms.items) {
            if (!p.active) continue;
            if (e.x < p.x || e.x > p.x + p.cols * TILE) continue;
            if (prevY <= p.y - 7 && e.y >= p.y - 7) {
              spawnDust(this.particles, e.x, p.y);
              e.active = false;
              break;
            }
          }
          if (e.y > VIEW_H + 20) e.active = false;
          break;
        }
        case "rusher":
          e.x += e.vx;
          if (e.x > VIEW_W + 30) e.active = false;
          break;
      }
    }
  }

  private spawnOneEnemy() {
    const roll = Math.random() * (this.frame > 1800 ? 10.5 : 9);
    if (roll < 4) {
      // 右侧地面爬行：找一块延伸到屏幕右缘的平台
      let plat: Platform | null = null;
      for (const p of this.platforms.items) {
        if (!p.active) continue;
        const right = p.x + p.cols * TILE;
        if (right >= VIEW_W - 4 && p.x < VIEW_W + 30) plat = p;
      }
      if (plat) {
        const e = spawnEnemy(this.enemies, "crawler", VIEW_W + 4, 0);
        if (e) e.plat = plat;
      }
    } else if (roll < 7) {
      // 右侧飞行：正弦高度逼近
      spawnEnemy(this.enemies, "flyer", VIEW_W + 20, 60 + Math.random() * 110);
    } else if (roll < 9) {
      // 上方空降：主角附近
      spawnEnemy(this.enemies, "dropper", HERO_X + (Math.random() - 0.5) * 120, -12);
    } else {
      // 左侧后方突袭：低空快速掠过主角高度
      spawnEnemy(this.enemies, "rusher", -24, this.heroY - 8);
    }
  }

  private collide() {
    const heroBox = { x: HERO_X - HERO_W / 2, y: this.heroY - HERO_H, w: HERO_W, h: HERO_H };
    // 子弹 × 敌人
    for (const b of this.bullets.items) {
      if (!b.active) continue;
      for (const e of this.enemies.items) {
        if (!e.active) continue;
        const box = enemyHitbox(e);
        if (
          b.x > box.x && b.x < box.x + box.w &&
          b.y > box.y && b.y < box.y + box.h
        ) {
          b.active = false;
          e.hp--;
          if (e.hp <= 0) {
            e.active = false;
            this.score += enemyDef(e.kind).score;
            spawnBurst(
              this.particles,
              e.x,
              e.y,
              ["#fabd2f", "#ebdbb2", "#8ec07c"],
              10,
            );
            this.audio.explode();
          } else {
            spawnBurst(this.particles, b.x, b.y, ["#ebdbb2"], 3);
            this.audio.hit();
          }
          break;
        }
      }
    }
    // 敌人 × 主角（无敌帧内忽略；撞到的敌人当场炸掉）
    if (this.invuln <= 0) {
      for (const e of this.enemies.items) {
        if (!e.active) continue;
        const box = enemyHitbox(e);
        if (
          heroBox.x < box.x + box.w &&
          heroBox.x + heroBox.w > box.x &&
          heroBox.y < box.y + box.h &&
          heroBox.y + heroBox.h > box.y
        ) {
          e.active = false;
          spawnBurst(this.particles, e.x, e.y, ["#fb4934", "#fabd2f"], 8);
          this.damage();
          break;
        }
      }
    }
  }

  private updateParticles() {
    for (const p of this.particles.items) {
      if (!p.active) continue;
      p.x += p.vx - this.scroll * 0.5;
      p.y += p.vy;
      p.vy += 0.06;
      p.life--;
      if (p.life <= 0) p.active = false;
    }
  }

  private decideHeroVisual() {
    this.heroVisible = !(this.invuln > 0 && this.frame % 8 < 4);
    this.heroState =
      this.hurtTimer > 0
        ? "hurt"
        : !this.onGround
          ? "jump"
          : this.muzzle > 0
            ? "shoot"
            : "run";
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.detachInput();
    this.audio.destroy();
  }
}

/** 窗口层入口：挂上 canvas 就能玩，destroy 干净收场 */
export function startGame(canvas: HTMLCanvasElement, opts: GameOptions): GameHandle {
  const game = new Game(canvas, opts);
  return {
    destroy() {
      game.destroy();
    },
  };
}

