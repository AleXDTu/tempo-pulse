/** 素材管线：Kenney 素材（构建期打包）+ 用户自定义 BGM / 主角图（应用数据目录运行时探测）。
 * 探测逻辑全部集中在本文件，别处不感知文件名约定。
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** 主角各状态图的约定文件名（放应用数据目录 game/hero/ 下，缺的状态画程序化小人） */
export const HERO_STATES = ["idle", "run", "jump", "shoot", "hurt"] as const;
export type HeroState = (typeof HERO_STATES)[number];

export interface GameSprites {
  /** 平台瓦片：左端帽 / 中段 / 右端帽（已做夜色处理） */
  tileLeft: CanvasImageSource;
  tileMid: CanvasImageSource;
  tileRight: CanvasImageSource;
  /** 敌人方块原图（染色在渲染层做） */
  block: HTMLImageElement;
  /** 子弹（16×16 竖条，绘制时按弹道旋转） */
  bullet: HTMLImageElement;
  /** 用户自定义主角图（按状态；缺的状态由渲染层画程序化像素小人） */
  hero: Partial<Record<HeroState, HTMLImageElement>>;
}

const tileUrls = import.meta.glob("../assets/game/kenney/tiles/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const blockUrls = import.meta.glob("../assets/game/kenney/blocks/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const bulletUrls = import.meta.glob("../assets/game/kenney/bullets/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`素材加载失败：${url}`));
    img.src = url;
  });
}

/** 夜色处理：压暗并偏蓝（Kenney 瓦片是白天亮色，屋顶夜景需要降明度）。
 * 一次性像素处理，不依赖 canvas filter（WKWebView 版本行为不一）。
 */
function nightTint(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    p[i] = Math.round(p[i] * 0.55);
    p[i + 1] = Math.round(p[i + 1] * 0.6);
    p[i + 2] = Math.min(255, Math.round(p[i + 2] * 0.8 + 14));
    p[i + 3] = Math.round(p[i + 3] * 0.95);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Rust 侧探测好的用户资源绝对路径（get_game_assets 命令返回，无文件为 null） */
interface GameAssetPaths {
  bgm: string | null;
  hero: Partial<Record<HeroState, string | null>>;
}

/** 应用数据目录里的用户资源探测（BGM 路径给 audio.ts 用，主角图这里消费） */
export async function fetchUserAssetPaths(): Promise<GameAssetPaths> {
  return invoke<GameAssetPaths>("get_game_assets");
}

/** 用户图加载：加载失败（文件损坏等）按「没提供」处理，回落占位图 */
function loadUserImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = convertFileSrc(path);
  });
}

/** 加载全部游戏素材（Kenney 打包素材 + 用户自定义主角图） */
export async function loadGameAssets(): Promise<GameSprites> {
  const tile = async (name: string) =>
    nightTint(await loadImage(tileUrls[`../assets/game/kenney/tiles/${name}.png`]));
  const [tileLeft, tileMid, tileRight, block, bullet] = await Promise.all([
    tile("tile_0132"),
    tile("tile_0133"),
    tile("tile_0134"),
    loadImage(blockUrls["../assets/game/kenney/blocks/tile_0000.png"]),
    loadImage(bulletUrls["../assets/game/kenney/bullets/tile_0000.png"]),
  ]);

  // 用户主角图探测：缺哪张（或加载失败）补哪张占位
  let paths: GameAssetPaths = { bgm: null, hero: {} };
  try {
    paths = await fetchUserAssetPaths();
  } catch {
    // 命令不存在（老版本 Rust 侧）或浏览器 harness 未注册：全部用占位图
    paths = { bgm: null, hero: {} };
  }
  const hero: Partial<Record<HeroState, HTMLImageElement>> = {};
  for (const state of HERO_STATES) {
    const p = paths.hero[state];
    const userImg = p ? await loadUserImage(p) : null;
    if (userImg) hero[state] = userImg;
  }

  return { tileLeft, tileMid, tileRight, block, bullet, hero };
}
