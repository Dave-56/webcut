/**
 * TransitionLayer - 转场层管理器
 *
 * 负责管理转场 Sprite 的生命周期：
 * 1. 根据 rail.transitions 数据创建对应的 TransitionSprite
 * 2. 将 TransitionSprite 添加到 AVCanvas 中
 * 3. 在转场数据变化时更新或销毁 TransitionSprite
 *
 * 架构说明：
 * - TransitionLayer 监听 rails 数据的变化
 * - 为每个 transition 创建一个 TransitionClip + VisibleSprite
 * - TransitionSprite 的 zIndex 设置为较高值，确保覆盖在原有内容之上
 * - 转场开始和结束时间对应 sprite 的 time.offset 和 time.duration
 */

import { VisibleSprite } from '@webav/av-cliper';
import { AVCanvas } from '@webav/av-canvas';
import type { WebCutRail, WebCutTransitionData, WebCutSegment, WebCutSource } from '../types';
import { TransitionClip } from './transition-clip';
import { FrameCache, frameCache } from './frame-cache';

/**
 * 转场 Sprite 信息
 */
export interface TransitionSpriteInfo {
  /** 转场 ID */
  transitionId: string;
  /** 轨道 ID */
  railId: string;
  /** TransitionClip 实例 */
  clip: TransitionClip;
  /** VisibleSprite 实例 */
  sprite: VisibleSprite;
  /** 转场数据快照（用于检测变化） */
  transitionSnapshot: string;
}

/**
 * TransitionLayer 配置
 */
export interface TransitionLayerConfig {
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** 转场 Sprite 的基础 zIndex */
  baseZIndex?: number;
}

/**
 * TransitionLayer 类
 */
export class TransitionLayer {
  private canvas: AVCanvas | null = null;
  private config: Required<TransitionLayerConfig>;
  private frameCache: FrameCache;

  /** 转场 Sprite 映射表，key 为 transitionId */
  private transitionSprites: Map<string, TransitionSpriteInfo> = new Map();

  /** 数据引用 */
  private rails: WebCutRail[] = [];
  private sources: Map<string, WebCutSource> = new Map();

  constructor(config: TransitionLayerConfig) {
    this.config = {
      width: config.width,
      height: config.height,
      baseZIndex: config.baseZIndex ?? 9999, // 默认使用较高的 zIndex
    };
    this.frameCache = frameCache;
  }

  /**
   * 绑定 AVCanvas
   */
  bindCanvas(canvas: AVCanvas): void {
    this.canvas = canvas;
  }

  /**
   * 解绑 AVCanvas
   */
  unbindCanvas(): void {
    // 移除所有转场 Sprite
    this.clearAll();
    this.canvas = null;
  }

  /**
   * 更新画布尺寸
   */
  updateSize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;

    // 需要重建所有转场 Sprite
    this.rebuildAll();
  }

  /**
   * 更新数据引用并同步转场 Sprite
   */
  updateData(rails: WebCutRail[], sources: Map<string, WebCutSource>): void {
    this.rails = rails;
    this.sources = sources;

    // 同步转场 Sprite
    this.syncTransitionSprites();
  }

  /**
   * 同步转场 Sprite
   * 根据当前 rails 数据，创建、更新或删除转场 Sprite
   */
  private syncTransitionSprites(): void {
    if (!this.canvas) return;

    const currentTransitionIds = new Set<string>();

    // 遍历所有轨道的转场
    for (const rail of this.rails) {
      if (!rail.transitions || rail.transitions.length === 0) continue;

      for (const transition of rail.transitions) {
        currentTransitionIds.add(transition.id);

        // 查找转场涉及的两个片段
        const segmentInfo = this.findTransitionSegments(rail, transition);
        if (!segmentInfo) {
          // 无法找到对应的片段，跳过
          continue;
        }

        const { fromSegment, toSegment } = segmentInfo;
        const transitionSnapshot = JSON.stringify({ transition, fromSegment, toSegment });

        // 检查是否已存在
        const existing = this.transitionSprites.get(transition.id);
        if (existing) {
          // 检查是否需要更新
          if (existing.transitionSnapshot !== transitionSnapshot) {
            // 数据变化，需要重建
            this.removeTransitionSprite(transition.id);
            this.createTransitionSprite(rail, transition, fromSegment, toSegment, transitionSnapshot);
          }
          // 数据未变化，保持现状
        } else {
          // 新转场，创建 Sprite
          this.createTransitionSprite(rail, transition, fromSegment, toSegment, transitionSnapshot);
        }
      }
    }

    // 删除不再存在的转场 Sprite
    for (const [transitionId] of this.transitionSprites) {
      if (!currentTransitionIds.has(transitionId)) {
        this.removeTransitionSprite(transitionId);
      }
    }
  }

  /**
   * 查找转场涉及的两个片段
   * 转场跨越两个相邻片段的交界处
   */
  private findTransitionSegments(
    rail: WebCutRail,
    transition: WebCutTransitionData
  ): { fromSegment: WebCutSegment; toSegment: WebCutSegment } | null {
    const segments = rail.segments;
    if (segments.length < 2) return null;

    // 转场的中点时间（交界处）
    const transitionMid = (transition.start + transition.end) / 2;
    // 允许的时间误差（100微秒）
    const epsilon = 100;

    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];

      // 检查转场中点是否在两个片段的交界处附近
      // 即 current.end ≈ next.start ≈ transitionMid
      const boundary = current.end;

      if (
        Math.abs(transitionMid - boundary) < epsilon + (transition.end - transition.start) / 2 &&
        transition.start >= current.start - epsilon &&
        transition.end <= next.end + epsilon
      ) {
        return { fromSegment: current, toSegment: next };
      }
    }

    // 备用方案：查找包含转场起点的片段和包含转场终点的片段
    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];

      const startInCurrent = transition.start >= current.start && transition.start <= current.end;
      const endInNext = transition.end >= next.start && transition.end <= next.end;

      if (startInCurrent && endInNext) {
        return { fromSegment: current, toSegment: next };
      }
    }

    console.warn('TransitionLayer: Could not find segments for transition', {
      transitionId: transition.id,
      transitionStart: transition.start,
      transitionEnd: transition.end,
      segments: segments.map(s => ({ id: s.id, start: s.start, end: s.end })),
    });

    return null;
  }

  /**
   * 创建转场 Sprite
   */
  private async createTransitionSprite(
    rail: WebCutRail,
    transition: WebCutTransitionData,
    fromSegment: WebCutSegment,
    toSegment: WebCutSegment,
    transitionSnapshot: string
  ): Promise<void> {
    if (!this.canvas) return;

    const { width, height, baseZIndex } = this.config;

    // 创建 TransitionClip
    const clip = new TransitionClip({
      transition,
      fromSegment,
      toSegment,
      width,
      height,
      sources: this.sources,
    });

    await clip.ready;

    // 创建 VisibleSprite - 使用内部的 ImgClip 确保兼容性
    const sprite = new VisibleSprite(clip.getInnerClip());

    // 设置时间
    sprite.time.offset = transition.start;
    sprite.time.duration = transition.end - transition.start;

    // 设置位置（全屏覆盖）
    sprite.rect.x = 0;
    sprite.rect.y = 0;
    sprite.rect.w = width;
    sprite.rect.h = height;

    // 设置 zIndex（确保在最上层）
    sprite.zIndex = baseZIndex;

    // 保存信息
    this.transitionSprites.set(transition.id, {
      transitionId: transition.id,
      railId: rail.id,
      clip,
      sprite,
      transitionSnapshot,
    });

    // 添加到 Canvas
    await this.canvas.addSprite(sprite);
  }

  /**
   * 移除转场 Sprite
   */
  private removeTransitionSprite(transitionId: string): void {
    const info = this.transitionSprites.get(transitionId);
    if (!info) return;

    const { clip, sprite } = info;

    // 从 Canvas 移除
    if (this.canvas) {
      this.canvas.removeSprite(sprite);
    }

    // 销毁资源
    sprite.destroy();
    clip.destroy();

    // 从映射表移除
    this.transitionSprites.delete(transitionId);
  }

  /**
   * 添加转场
   */
  async addTransition(railId: string, transition: WebCutTransitionData): Promise<void> {
    const rail = this.rails.find(r => r.id === railId);
    if (!rail) return;

    const segmentInfo = this.findTransitionSegments(rail, transition);
    if (!segmentInfo) return;

    const { fromSegment, toSegment } = segmentInfo;
    const transitionSnapshot = JSON.stringify({ transition, fromSegment, toSegment });

    await this.createTransitionSprite(rail, transition, fromSegment, toSegment, transitionSnapshot);
  }

  /**
   * 移除转场
   */
  removeTransition(transitionId: string): void {
    this.removeTransitionSprite(transitionId);
  }

  /**
   * 更新转场
   */
  async updateTransition(railId: string, transition: WebCutTransitionData): Promise<void> {
    // 先移除旧的
    this.removeTransitionSprite(transition.id);

    // 创建新的
    await this.addTransition(railId, transition);
  }

  /**
   * 清除所有转场 Sprite
   */
  clearAll(): void {
    for (const [transitionId] of this.transitionSprites) {
      this.removeTransitionSprite(transitionId);
    }
    this.transitionSprites.clear();
  }

  /**
   * 重建所有转场 Sprite（尺寸变化时调用）
   */
  private rebuildAll(): void {
    // 清除所有
    this.clearAll();

    // 重新同步（会重建所有转场 Sprite）
    this.syncTransitionSprites();
  }

  /**
   * 获取所有转场 Sprite
   */
  getTransitionSprites(): Map<string, TransitionSpriteInfo> {
    return new Map(this.transitionSprites);
  }

  /**
   * 获取指定转场的 Sprite
   */
  getTransitionSprite(transitionId: string): TransitionSpriteInfo | undefined {
    return this.transitionSprites.get(transitionId);
  }

  /**
   * 预缓存指定轨道的转场帧
   */
  async preCacheRailTransitions(railId: string): Promise<void> {
    const rail = this.rails.find(r => r.id === railId);
    if (!rail || !rail.transitions) return;

    const promises: Promise<void>[] = [];

    for (const transition of rail.transitions) {
      const segmentInfo = this.findTransitionSegments(rail, transition);
      if (!segmentInfo) continue;

      const { fromSegment, toSegment } = segmentInfo;

      // 预缓存 from 片段的尾帧
      const fromSource = this.sources.get(fromSegment.sourceKey);
      if (fromSource?.clip && 'clone' in fromSource.clip) {
        promises.push(this.frameCache.preCacheKeyFrames(fromSegment.sourceKey, fromSource.clip as any));
      }

      // 预缓存 to 片段的首帧
      const toSource = this.sources.get(toSegment.sourceKey);
      if (toSource?.clip && 'clone' in toSource.clip) {
        promises.push(this.frameCache.preCacheKeyFrames(toSegment.sourceKey, toSource.clip as any));
      }
    }

    await Promise.all(promises);
  }

  /**
   * 预缓存所有转场帧
   */
  async preCacheAllTransitions(): Promise<void> {
    const promises = this.rails.map(rail => this.preCacheRailTransitions(rail.id));
    await Promise.all(promises);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    transitionCount: number;
    spriteCount: number;
  } {
    return {
      transitionCount: this.transitionSprites.size,
      spriteCount: this.transitionSprites.size,
    };
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.clearAll();
    this.canvas = null;
    this.rails = [];
    this.sources = new Map();
  }
}

// 创建全局实例
export const transitionLayer = new TransitionLayer({
  width: 1920,
  height: 1080,
});
