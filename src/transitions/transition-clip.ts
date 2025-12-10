/**
 * TransitionClip - 独立的转场 Clip
 *
 * 基于 ImgClip 的转场实现，确保与 @webav/av-cliper 完全兼容。
 * 在 tick 时动态获取相邻片段的帧数据，然后应用转场效果生成新的帧。
 *
 * 架构说明：
 * - TransitionClip 内部使用 ImgClip 作为基础
 * - 通过 tickInterceptor 拦截并替换输出帧为转场效果帧
 * - 它被包装在 VisibleSprite 中添加到 AVCanvas
 */

import { ImgClip } from '@webav/av-cliper';
import type { WebCutTransitionData, WebCutSegment, WebCutSource } from '../types';
import { WebGLTransitionRenderer, webglRenderer } from './webgl-renderer';
import { FrameCache, frameCache } from './frame-cache';

export interface TransitionClipConfig {
  /** 转场数据 */
  transition: WebCutTransitionData;
  /** 前一个片段 */
  fromSegment: WebCutSegment;
  /** 后一个片段 */
  toSegment: WebCutSegment;
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** sources 引用，用于获取片段的 clip */
  sources: Map<string, WebCutSource>;
}

/**
 * 创建一个纯色的占位图片
 */
function createPlaceholderBitmap(width: number, height: number): ImageBitmap {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  // 透明背景
  ctx.clearRect(0, 0, width, height);
  return canvas.transferToImageBitmap();
}

/**
 * TransitionClip 类
 * 基于 ImgClip 实现，确保与 VisibleSprite 完全兼容
 */
export class TransitionClip {
  /** 内部使用的 ImgClip */
  private innerClip: ImgClip;

  /** 转场持续时间 */
  private duration: number;

  /** Clip 就绪 Promise */
  ready: Promise<void>;

  /** Clip 元数据 - 代理到 innerClip */
  get meta() {
    return { ...this.innerClip.meta, duration: this.duration };
  }

  /** tick 拦截器 - 代理到 innerClip */
  get tickInterceptor() {
    return this.innerClip.tickInterceptor;
  }
  set tickInterceptor(v) {
    this.innerClip.tickInterceptor = v;
  }

  /** 获取内部 clip，用于 VisibleSprite */
  getInnerClip(): ImgClip {
    return this.innerClip;
  }

  private config: TransitionClipConfig;
  private webglRenderer: WebGLTransitionRenderer;
  private frameCache: FrameCache;
  private transitionCanvas: OffscreenCanvas;
  private transitionCtx: OffscreenCanvasRenderingContext2D;
  private destroyed: boolean = false;

  /** 缓存的帧数据 */
  private fromFrameCache: ImageBitmap | null = null;
  private toFrameCache: ImageBitmap | null = null;

  constructor(config: TransitionClipConfig) {
    // 确保 config 有效
    if (!config || !config.transition) {
      throw new Error('TransitionClip: invalid config');
    }

    this.config = config;
    this.webglRenderer = webglRenderer;
    this.frameCache = frameCache;

    const { transition, width = 1920, height = 1080 } = config;
    // 设置转场持续时间
    this.duration = Math.max(0, transition.end - transition.start);

    // 创建占位图片
    const placeholderBitmap = createPlaceholderBitmap(width, height);

    // 创建内部 ImgClip
    this.innerClip = new ImgClip(placeholderBitmap);

    // 创建用于转场渲染的 canvas
    this.transitionCanvas = new OffscreenCanvas(width, height);
    this.transitionCtx = this.transitionCanvas.getContext('2d')!;

    // 初始化
    this.ready = this.initialize(this.duration);
  }

  /**
   * 初始化，预加载转场所需的帧并设置 tickInterceptor
   */
  private async initialize(duration: number): Promise<void> {
    // 等待内部 clip 就绪
    await this.innerClip.ready;

    const { fromSegment, toSegment, sources, transition } = this.config;

    // 预缓存 from 片段的尾帧
    await this.preCacheFrame(fromSegment, 'end', sources);
    // 预缓存 to 片段的首帧
    await this.preCacheFrame(toSegment, 'start', sources);

    // 设置 tickInterceptor 来渲染转场效果
    this.innerClip.tickInterceptor = async <T extends Record<string, any>>(time: number, tickRet: T): Promise<T> => {
      if (this.destroyed) {
        return tickRet;
      }

      // 计算进度
      const progress = Math.max(0, Math.min(1, time / duration));

      try {
        // 获取 from 和 to 帧
        const fromBitmap = await this.getFromFrame();
        const toBitmap = await this.getToFrame();

        if (!fromBitmap || !toBitmap) {
          return tickRet;
        }

        // 关闭原始帧
        if (tickRet.video instanceof VideoFrame) {
          tickRet.video.close();
        }

        // 渲染转场效果
        const transitionFrame = await this.renderTransition(fromBitmap, toBitmap, progress, time, transition);
        (tickRet as any).video = transitionFrame;

        return tickRet;
      } catch (e) {
        console.error('TransitionClip tick error:', e);
        return tickRet;
      }
    };
  }

  /**
   * 预缓存片段的帧
   */
  private async preCacheFrame(
    segment: WebCutSegment,
    position: 'start' | 'end',
    sources: Map<string, WebCutSource>
  ): Promise<void> {
    const source = sources.get(segment.sourceKey);
    if (!source || !source.clip) return;

    const clip = source.clip as any;
    if (!clip.clone || !clip.meta) return;

    try {
      // 先检查全局缓存
      const cachedBitmap = this.frameCache.getFrame(segment.sourceKey, position);
      if (cachedBitmap) {
        if (position === 'end') {
          this.fromFrameCache = cachedBitmap;
        } else {
          this.toFrameCache = cachedBitmap;
        }
        return;
      }

      // 没有缓存，需要获取帧
      const { duration } = clip.meta;
      const clonedClip = await clip.clone();
      await clonedClip.ready;

      // 移除 tickInterceptor 避免递归
      if (typeof clonedClip.tickInterceptor === 'function') {
        clonedClip.tickInterceptor = null;
      }

      const targetTime = position === 'start' ? 0 : Math.max(0, duration - 1e5);
      const ret = await clonedClip.tick(targetTime);
      clonedClip.destroy();

      if (ret.video) {
        const bitmap = await createImageBitmap(ret.video);
        ret.video.close();

        // 存入本地缓存
        if (position === 'end') {
          this.fromFrameCache = bitmap;
        } else {
          this.toFrameCache = bitmap;
        }

        // 存入全局缓存
        await this.frameCache.cacheFrame(segment.sourceKey, position, bitmap);
      }
    } catch (e) {
      console.warn(`Failed to pre-cache frame for segment ${segment.id}:`, e);
    }
  }

  /**
   * 渲染转场效果
   */
  private async renderTransition(
    fromBitmap: ImageBitmap,
    toBitmap: ImageBitmap,
    progress: number,
    time: number,
    transition: WebCutTransitionData
  ): Promise<VideoFrame> {
    // 创建 VideoFrame 用于转场渲染
    const fromFrame = new VideoFrame(fromBitmap, { timestamp: time });
    const toFrame = new VideoFrame(toBitmap, { timestamp: time });

    let resultFrame: VideoFrame;

    try {
      // 使用 WebGL 渲染转场
      if (this.webglRenderer.isWebGLSupported()) {
        resultFrame = await this.webglRenderer.renderTransition(
          fromFrame,
          toFrame,
          progress,
          transition.name,
          transition.config || {}
        );
      } else {
        // Canvas2D 回退
        resultFrame = await this.canvas2DTransition(fromFrame, toFrame, progress);
      }
    } finally {
      fromFrame.close();
      toFrame.close();
    }

    return resultFrame;
  }

  /**
   * tick 方法 - 代理到内部 clip
   * @param time 相对于转场开始的时间（微秒）
   */
  async tick(time: number): Promise<{
    video: VideoFrame | null;
    audio: Float32Array[];
    state: 'done' | 'success';
  }> {
    // 时间已超过转场持续时间，返回 done
    if (time >= this.duration) {
      return {
        video: null,
        audio: [],
        state: 'done',
      };
    }

    const result = await this.innerClip.tick(time);
    // 不管内部 clip 返回什么状态，只要未到转场持续时间，都返回 success
    return {
      video: result.video instanceof VideoFrame ? result.video : null,
      audio: [],
      state: 'success',
    };
  }

  /**
   * 获取 from 帧（前一个片段的尾帧）
   */
  private async getFromFrame(): Promise<ImageBitmap | null> {
    if (this.fromFrameCache) {
      return this.fromFrameCache;
    }

    const { fromSegment, sources } = this.config;
    const cachedBitmap = this.frameCache.getFrame(fromSegment.sourceKey, 'end');
    if (cachedBitmap) {
      this.fromFrameCache = cachedBitmap;
      return cachedBitmap;
    }

    // 尝试重新获取
    await this.preCacheFrame(fromSegment, 'end', sources);
    return this.fromFrameCache;
  }

  /**
   * 获取 to 帧（后一个片段的首帧）
   */
  private async getToFrame(): Promise<ImageBitmap | null> {
    if (this.toFrameCache) {
      return this.toFrameCache;
    }

    const { toSegment, sources } = this.config;
    const cachedBitmap = this.frameCache.getFrame(toSegment.sourceKey, 'start');
    if (cachedBitmap) {
      this.toFrameCache = cachedBitmap;
      return cachedBitmap;
    }

    // 尝试重新获取
    await this.preCacheFrame(toSegment, 'start', sources);
    return this.toFrameCache;
  }

  /**
   * Canvas2D 转场回退
   */
  private async canvas2DTransition(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number
  ): Promise<VideoFrame> {
    const { width, height } = this.config;
    this.transitionCanvas.width = width;
    this.transitionCanvas.height = height;

    this.transitionCtx.clearRect(0, 0, width, height);

    // 简单的透明度混合
    this.transitionCtx.globalAlpha = 1 - progress;
    this.transitionCtx.drawImage(fromFrame, 0, 0, width, height);

    this.transitionCtx.globalAlpha = progress;
    this.transitionCtx.drawImage(toFrame, 0, 0, width, height);

    this.transitionCtx.globalAlpha = 1;

    return new VideoFrame(this.transitionCanvas, {
      timestamp: fromFrame.timestamp,
    });
  }

  /**
   * 分割 Clip（保持接口兼容，但转场 Clip 不支持分割）
   */
  async split(_time: number): Promise<[TransitionClip, TransitionClip]> {
    throw new Error('TransitionClip does not support split');
  }

  /**
   * 克隆 Clip
   */
  async clone(): Promise<TransitionClip> {
    const cloned = new TransitionClip({ ...this.config });
    await cloned.ready;
    return cloned;
  }

  /**
   * 销毁 Clip
   */
  destroy(): void {
    this.destroyed = true;
    this.fromFrameCache = null;
    this.toFrameCache = null;
    this.innerClip.destroy();
    this.transitionCanvas.width = 0;
    this.transitionCanvas.height = 0;
  }
}
