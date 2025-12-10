import { BaseTransition, TransitionConfig } from './base-transition';

/**
 * 转场管理器类
 */
export class TransitionManager {
  private transitions: Map<string, BaseTransition> = new Map();

  /**
   * 注册转场效果
   * @param transition 转场实例
   */
  registerTransition(transition: BaseTransition): void {
    this.transitions.set(transition.name, transition);
  }

  /**
   * 获取转场实例
   * @param name 转场名称
   * @returns 转场实例
   */
  getTransition(name: string): BaseTransition | undefined {
    return this.transitions.get(name);
  }

  /**
   * 获取所有已注册的转场名称
   * @returns 转场名称列表
   */
  getTransitionNames(): string[] {
    return Array.from(this.transitions.keys());
  }

  /**
   * 获取所有已注册转场的默认配置
   */
  getTransitionDefaults() {
    const names = this.getTransitionNames();
    const defaults: Record<string, {
      name: string;
      defaultDuration: number;
      defaultConfig: TransitionConfig;
    }> = {};
    names.forEach((name) => {
      defaults[name] = {
        name,
        defaultDuration: this.getTransition(name)?.defaultDuration || 0,
        defaultConfig: this.getTransition(name)?.defaultConfig || {},
      };
    });
    return defaults;
  }

  /**
   * 应用转场效果
   * @param fromFrame 起始帧
   * @param toFrame 结束帧
   * @param progress 进度值，0-1之间
   * @param transitionName 转场名称
   * @param config 转场配置
   * @returns 处理后的VideoFrame
   */
  async applyTransition(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    transitionName: string,
    config: TransitionConfig = {}
  ): Promise<VideoFrame> {
    const transition = this.getTransition(transitionName);

    if (!transition) {
      console.warn(`Transition "${transitionName}" not found, using default blend`);
      return this.defaultBlend(fromFrame, toFrame, progress);
    }

    try {
      return await transition.apply(fromFrame, toFrame, progress, config);
    } catch (error) {
      console.error(`Error applying transition "${transitionName}":`, error);
      return this.defaultBlend(fromFrame, toFrame, progress);
    }
  }

  /**
   * 生成转场帧序列
   * @param fromFrame 起始帧
   * @param toFrame 结束帧
   * @param transitionName 转场名称
   * @param frameCount 帧数量
   * @param config 转场配置
   * @returns 转场帧序列
   */
  async generateTransitionFrames(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    transitionName: string,
    frameCount: number,
    config: TransitionConfig = {}
  ): Promise<VideoFrame[]> {
    const frames: VideoFrame[] = [];

    for (let i = 0; i < frameCount; i++) {
      const progress = frameCount > 1 ? i / (frameCount - 1) : 1;

      const frame = await this.applyTransition(
        fromFrame,
        toFrame,
        progress,
        transitionName,
        config
      );
      frames.push(frame);
    }

    return frames;
  }

  /**
   * 默认混合效果（简单的透明度混合）
   */
  private async defaultBlend(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number
  ): Promise<VideoFrame> {
    const canvas = new OffscreenCanvas(fromFrame.displayWidth, fromFrame.displayHeight);
    const ctx = canvas.getContext('2d')!;

    // 绘制起始帧
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(fromFrame, 0, 0);

    // 绘制结束帧
    ctx.globalAlpha = progress;
    ctx.drawImage(toFrame, 0, 0);

    ctx.globalAlpha = 1;

    return new VideoFrame(canvas, {
      timestamp: fromFrame.timestamp,
      duration: fromFrame.duration || undefined,
    });
  }

  /**
   * 关闭转场管理器，释放所有转场资源
   */
  dispose(): void {
    for (const transition of this.transitions.values()) {
      transition.dispose();
    }
    this.transitions.clear();
  }
}
