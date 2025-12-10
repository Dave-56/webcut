/**
 * 全局转场管理器
 *
 * 新架构说明：
 * - 转场不再通过 clip 的 tickInterceptor 处理
 * - 转场作为独立的 Sprite 层渲染到 AVCanvas
 * - GlobalTransitionManager 负责协调 TransitionLayer 和其他转场组件
 *
 * 使用方式：
 * 1. 在 AVCanvas 初始化后调用 bindCanvas()
 * 2. 当 rails 数据变化时调用 updateData()
 * 3. TransitionLayer 会自动管理转场 Sprite 的生命周期
 */

import type { AVCanvas } from '@webav/av-canvas';
import type { WebCutRail, WebCutTransitionData, WebCutSource } from '../types';
import { TransitionLayer, transitionLayer, type TransitionSpriteInfo } from './transition-layer';
import { FrameCache, frameCache } from './frame-cache';
import { WebGLTransitionRenderer, webglRenderer } from './webgl-renderer';

/**
 * 全局转场管理器配置
 */
export interface GlobalTransitionManagerConfig {
  /** 是否使用 WebGL 加速 */
  useWebGL?: boolean;
  /** 转场 Sprite 的基础 zIndex */
  baseZIndex?: number;
}

/**
 * 全局转场管理器类
 */
export class GlobalTransitionManager {
  private transitionLayer: TransitionLayer;
  private frameCache: FrameCache;
  private webglRenderer: WebGLTransitionRenderer;
  private config: Required<GlobalTransitionManagerConfig>;

  /** 数据引用 */
  private rails: WebCutRail[] = [];
  private sources: Map<string, WebCutSource> = new Map();

  /** AVCanvas 引用（保留用于未来扩展） */
  private _canvas: AVCanvas | null = null;

  /** 画布尺寸 */
  private width: number = 1920;
  private height: number = 1080;

  constructor(config: GlobalTransitionManagerConfig = {}) {
    this.config = {
      useWebGL: config.useWebGL ?? true,
      baseZIndex: config.baseZIndex ?? 9999,
    };

    this.transitionLayer = transitionLayer;
    this.frameCache = frameCache;
    this.webglRenderer = webglRenderer;

    // 初始化 WebGL
    if (this.config.useWebGL) {
      this.webglRenderer.init();
    }
  }

  /**
   * 绑定 AVCanvas
   * 在 AVCanvas 初始化后调用
   */
  bindCanvas(canvas: AVCanvas, width: number, height: number): void {
    this._canvas = canvas;
    this.width = width;
    this.height = height;

    // 更新 TransitionLayer 配置并绑定
    this.transitionLayer.updateSize(width, height);
    this.transitionLayer.bindCanvas(canvas);

    // 如果已有数据，同步转场 Sprite
    if (this.rails.length > 0) {
      this.transitionLayer.updateData(this.rails, this.sources);
    }
  }

  /**
   * 解绑 AVCanvas
   */
  unbindCanvas(): void {
    this.transitionLayer.unbindCanvas();
    this._canvas = null;
  }

  /**
   * 更新画布尺寸
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.transitionLayer.updateSize(width, height);
  }

  /**
   * 更新数据引用
   * 当 rails 或 sources 变化时调用
   */
  updateData(rails: WebCutRail[], sources: Map<string, WebCutSource>): void {
    this.rails = rails;
    this.sources = sources;

    // 同步转场 Sprite
    this.transitionLayer.updateData(rails, sources);
  }

  /**
   * 添加转场
   */
  async addTransition(railId: string, transition: WebCutTransitionData): Promise<void> {
    // 更新 rails 数据中的转场
    const rail = this.rails.find(r => r.id === railId);
    if (rail) {
      if (!rail.transitions) {
        rail.transitions = [];
      }
      // 检查是否已存在
      const existingIndex = rail.transitions.findIndex(t => t.id === transition.id);
      if (existingIndex >= 0) {
        rail.transitions[existingIndex] = transition;
      } else {
        rail.transitions.push(transition);
      }
    }

    // 创建转场 Sprite
    await this.transitionLayer.addTransition(railId, transition);
  }

  /**
   * 移除转场
   */
  removeTransition(railId: string, transitionId: string): void {
    // 更新 rails 数据
    const rail = this.rails.find(r => r.id === railId);
    if (rail && rail.transitions) {
      const index = rail.transitions.findIndex(t => t.id === transitionId);
      if (index >= 0) {
        rail.transitions.splice(index, 1);
      }
    }

    // 移除转场 Sprite
    this.transitionLayer.removeTransition(transitionId);
  }

  /**
   * 更新转场
   */
  async updateTransition(railId: string, transition: WebCutTransitionData): Promise<void> {
    // 更新 rails 数据
    const rail = this.rails.find(r => r.id === railId);
    if (rail && rail.transitions) {
      const index = rail.transitions.findIndex(t => t.id === transition.id);
      if (index >= 0) {
        rail.transitions[index] = transition;
      }
    }

    // 更新转场 Sprite
    await this.transitionLayer.updateTransition(railId, transition);
  }

  /**
   * 预缓存所有转场帧
   */
  async preCacheAllTransitions(): Promise<void> {
    await this.transitionLayer.preCacheAllTransitions();
  }

  /**
   * 预缓存指定轨道的转场帧
   */
  async preCacheRailTransitions(railId: string): Promise<void> {
    await this.transitionLayer.preCacheRailTransitions(railId);
  }

  /**
   * 清除所有转场
   */
  clearAll(): void {
    this.transitionLayer.clearAll();
  }

  /**
   * 获取转场 Sprite 信息
   */
  getTransitionSprite(transitionId: string): TransitionSpriteInfo | undefined {
    return this.transitionLayer.getTransitionSprite(transitionId);
  }

  /**
   * 获取所有转场 Sprite
   */
  getTransitionSprites(): Map<string, TransitionSpriteInfo> {
    return this.transitionLayer.getTransitionSprites();
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return this.frameCache.getStats();
  }

  /**
   * 获取转场层统计信息
   */
  getLayerStats() {
    return this.transitionLayer.getStats();
  }

  /**
   * 清理帧缓存
   */
  clearFrameCache(): void {
    this.frameCache.clearAll();
  }

  /**
   * 清理过期帧缓存
   */
  cleanExpiredCache(): void {
    this.frameCache.cleanExpired();
  }

  /**
   * 检查是否支持 WebGL
   */
  isWebGLSupported(): boolean {
    return this.webglRenderer.isWebGLSupported();
  }

  /**
   * 获取当前画布尺寸
   */
  getCanvasSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * 检查是否已绑定画布
   */
  isBound(): boolean {
    return this._canvas !== null;
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.transitionLayer.dispose();
    this.frameCache.dispose();
    this.webglRenderer.destroy();
    this._canvas = null;
    this.rails = [];
    this.sources = new Map();
  }
}

// 创建全局实例
export const globalTransitionManager = new GlobalTransitionManager();

// 为了向后兼容，保留一些旧的类型导出
export interface TransitionInfo {
  transition: WebCutTransitionData;
  rail: WebCutRail;
  fromSegment: { id: string; sourceKey: string };
  toSegment: { id: string; sourceKey: string };
  progress: number;
}

export interface TransitionTimeRange {
  start: number;
  end: number;
  transitionId: string;
  railId: string;
}
