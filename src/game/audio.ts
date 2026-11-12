/** 音频：BGM 从应用数据目录加载（用户自己的 mp3/wav，无文件静音不报错），
 * 射击/命中/受伤等音效用 Web Audio 现场合成（零素材）。
 * 加载点全部集中在本文件。
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { fetchUserAssetPaths } from "./assets";

/** BGM 约定文件名 bgm.mp3 / bgm.wav（应用数据目录 game/ 下，
 * 探测在 Rust 侧 get_game_assets，按声明顺序取第一个存在的） */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private bgm: HTMLAudioElement | null = null;
  private muted = false;

  /** 首次用户交互后调用（浏览器/WKWebView 的自动播放策略） */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    if (this.bgm?.paused) {
      void this.bgm.play().catch(() => {
        // 播放被策略拦下：下次交互 unlock 再试
      });
    }
  }

  /** 加载 BGM：应用数据目录 game/bgm.mp3|wav（convertFileSrc 通道）。
   * 没有文件静音不报错（BGM 是用户可选资源）。
   */
  async loadBgm(): Promise<boolean> {
    let bgmPath: string | null = null;
    try {
      const paths = await fetchUserAssetPaths();
      bgmPath = paths.bgm;
    } catch {
      // 命令不可用（浏览器 harness 未注册）：静音
      return false;
    }
    if (!bgmPath) return false;

    const audio = new Audio(convertFileSrc(bgmPath));
    audio.loop = true;
    audio.volume = 0.7;
    // 项目 lib 是 ES2020（没有 Promise.withResolvers），用执行器形式
    const loaded = await new Promise<HTMLAudioElement | null>((resolve) => {
      audio.oncanplaythrough = () => resolve(audio);
      audio.onerror = () => resolve(null); // 文件损坏按「没有 BGM」处理
      audio.load();
    });
    if (!loaded) return false;
    this.bgm = loaded;
    if (!this.muted) {
      void loaded.play().catch(() => {
        // 自动播放被拦：等 unlock
      });
    }
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.bgm) this.bgm.muted = muted;
  }

  isMuted() {
    return this.muted;
  }

  /** 单个合成音：oscillator 类型 + 频率滑动 + 音量包络 */
  private beep(
    type: OscillatorType,
    from: number,
    to: number,
    durMs: number,
    gain: number,
  ) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + durMs / 1000);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  }

  shoot() {
    this.beep("square", 880, 220, 0.07, 0.05);
  }

  hit() {
    this.beep("triangle", 300, 80, 0.12, 0.12);
  }

  hurt() {
    this.beep("sawtooth", 200, 55, 0.3, 0.14);
  }

  jump() {
    this.beep("sine", 240, 520, 0.12, 0.08);
  }

  explode() {
    this.beep("square", 160, 40, 0.22, 0.12);
  }

  gameover() {
    this.beep("triangle", 440, 110, 0.8, 0.16);
  }

  destroy() {
    this.bgm?.pause();
    this.bgm = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
