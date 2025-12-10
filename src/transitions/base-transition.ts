/**
 * 转场配置接口
 */
export interface TransitionConfig {
  [key: string]: any;
}

/**
 * 转场基类
 * 与滤镜不同，转场需要处理两个帧（from和to），并根据进度生成过渡帧
 */
export abstract class BaseTransition {
  /**
   * 转场名称
   */
  abstract name: string;
  /**
   * 默认持续时间（微秒）
   */
  abstract defaultDuration: number;
  /**
   * 默认配置
   */
  abstract defaultConfig: TransitionConfig;

  /**
   * 应用转场效果到两个VideoFrame
   * @param fromFrame 起始帧（前一个片段的最后一帧）
   * @param toFrame 结束帧（后一个片段的第一帧）
   * @param progress 进度值，0-1之间
   * @param config 转场配置
   * @returns 处理后的VideoFrame
   */
  abstract apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame>;

  /**
   * 关闭转场资源
   */
  dispose(): void {
    // 默认实现，子类可重写
  }

  /**
   * 创建带有正确时间戳的VideoFrame
   * @param canvas 画布
   * @param timestamp 时间戳（微秒）
   * @param duration 持续时间（微秒）
   */
  protected createVideoFrame(
    canvas: OffscreenCanvas,
    timestamp: number,
    duration?: number
  ): VideoFrame {
    return new VideoFrame(canvas, {
      timestamp,
      duration: duration || undefined,
    });
  }
}
