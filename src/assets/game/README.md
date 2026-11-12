# 游戏素材登记表

仓库内游戏素材全部来自 Kenney（CC0，可商用免版税）或程序化生成。只登记实际入库的文件，整包不进仓库。

| 子目录 | 文件 | 来源包 / 原始路径 | 许可证 | 用途 |
| --- | --- | --- | --- | --- |
| `kenney/tiles/` | tile_0132.png、tile_0133.png、tile_0134.png | kenney_pixelplatformer/Tiles（18×18 瓦片；132=左端帽 133=中段 134=右端帽，蓝色金属玻璃族） | Kenney，CC0 | 屋顶平台瓦片（加载时做夜色压暗处理） |
| `kenney/blocks/` | tile_0000.png | pixel_platformer_blocks/Tiles/Rock（18×18 方块） | Kenney，CC0 | 敌人共用形状（渲染时按敌人种类程序染色区分） |
| `kenney/bullets/` | tile_0000.png | kenney_pixelshmup/Tiles（16×16 竖直弹条） | Kenney，CC0 | 机枪子弹（绘制时按弹道角度旋转） |

## 程序化生成（零素材）

- 夜空渐变、星星、月亮、云层、远景/近景城市楼群剪影（含亮窗点阵、天线航空灯）、前景装饰（天线/广告牌剪影）、主角像素小人（14×18 点阵，红头带 + 浅色人形，跑步/跳跃/受击状态与朝向镜像）：全部在 `src/game/render.ts` 里按 seed 程序化生成（用户拍板：背景不用 Kenney，走程序化城市剪影）。

## 用户自定义资源（不进仓库，运行时探测）

放应用数据目录 `game/`（状态 tab 摸鱼区「打开游戏资源目录」直达），探测逻辑集中在 `src/game/assets.ts`（主角图）与 `src/game/audio.ts`（BGM）：

- BGM：`game/bgm.mp3` 或 `game/bgm.wav`（按此顺序取第一个存在的；不收 ogg——macOS WKWebView 对 Ogg Vorbis 支持不完整）。没有文件则静音，不报错。
- 主角各状态图：`game/hero/hero-idle.png`、`hero-run.png`、`hero-jump.png`、`hero-shoot.png`、`hero-hurt.png`，建议 24×24（18×18 或 36×36 也可，运行时等比缩放到 24×24 目标框）。缺哪张（或文件损坏）画程序化像素小人。
