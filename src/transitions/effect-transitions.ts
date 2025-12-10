import { BaseTransition, type TransitionConfig } from './base-transition';

/**
 * 淡入淡出转场
 * 前一帧逐渐淡出，后一帧逐渐淡入
 */
export class FadeTransition extends BaseTransition {
  name = 'fade';
  defaultDuration = 1e6;
  defaultConfig = {};

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    _config: TransitionConfig
  ): Promise<VideoFrame> {
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    // 清空画布
    this.ctx.clearRect(0, 0, width, height);

    // 绘制起始帧（逐渐淡出）
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.drawImage(fromFrame, 0, 0);

    // 绘制结束帧（逐渐淡入）
    this.ctx.globalAlpha = progress;
    this.ctx.drawImage(toFrame, 0, 0);

    this.ctx.globalAlpha = 1;

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 缩放转场
 * 前一帧缩放淡出，后一帧缩放淡入
 */
export class ZoomTransition extends BaseTransition {
  name = 'zoom';
  defaultDuration = 1.5e6;
  defaultConfig = {
      fromScale: 1,
      toScale: 1.2,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { fromScale = 1, toScale = 1.2, direction = 'in' } = config;
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    // 根据方向计算缩放
    let scale1: number, scale2: number;
    if (direction === 'in') {
      // 前一帧放大，后一帧从小变大
      scale1 = fromScale + (toScale - fromScale) * progress;
      scale2 = (1 - progress) * 0.8 + progress;
    } else {
      // 前一帧缩小，后一帧从大变小
      scale1 = fromScale - (fromScale - 1) * progress * 0.5;
      scale2 = toScale - (toScale - 1) * progress;
    }

    // 绘制起始帧（缩放）
    this.ctx.save();
    this.ctx.translate(width / 2, height / 2);
    this.ctx.scale(scale1, scale1);
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.translate(-width / 2, -height / 2);
    this.ctx.drawImage(fromFrame, 0, 0);
    this.ctx.restore();

    // 绘制结束帧（缩放）
    this.ctx.save();
    this.ctx.translate(width / 2, height / 2);
    this.ctx.scale(scale2, scale2);
    this.ctx.globalAlpha = progress;
    this.ctx.translate(-width / 2, -height / 2);
    this.ctx.drawImage(toFrame, 0, 0);
    this.ctx.restore();

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 滑动方向类型
 */
export type SlideDirection = 'left' | 'right' | 'up' | 'down';

/**
 * 滑动转场
 * 支持四个方向：左、右、上、下
 */
export class SlideTransition extends BaseTransition {
  name = 'slide';
  defaultDuration = 1.5e6;
  defaultConfig = {
    direction: 'right',
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { direction = 'left' } = config as { direction?: SlideDirection };
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    // 计算偏移量
    let fromX = 0, fromY = 0;
    let toX = 0, toY = 0;

    switch (direction) {
      case 'left':
        fromX = -width * progress;
        toX = width * (1 - progress);
        break;
      case 'right':
        fromX = width * progress;
        toX = -width * (1 - progress);
        break;
      case 'up':
        fromY = -height * progress;
        toY = height * (1 - progress);
        break;
      case 'down':
        fromY = height * progress;
        toY = -height * (1 - progress);
        break;
    }

    // 绘制起始帧
    this.ctx.drawImage(fromFrame, fromX, fromY);

    // 绘制结束帧
    this.ctx.drawImage(toFrame, toX, toY);

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 旋转转场
 * 前一帧旋转退出，后一帧旋转进入
 */
export class RotateTransition extends BaseTransition {
  name = 'rotate';
  defaultDuration = 2e6;
  defaultConfig = {
    angle: 180,
    clockwise: true,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { angle = 180, clockwise = true } = config;
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    const rotationAngle = ((clockwise ? 1 : -1) * angle * Math.PI) / 180;

    // 绘制起始帧（旋转退出）
    this.ctx.save();
    this.ctx.translate(width / 2, height / 2);
    this.ctx.rotate(rotationAngle * progress);
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.translate(-width / 2, -height / 2);
    this.ctx.drawImage(fromFrame, 0, 0);
    this.ctx.restore();

    // 绘制结束帧（旋转进入）
    this.ctx.save();
    this.ctx.translate(width / 2, height / 2);
    this.ctx.rotate(-rotationAngle * (1 - progress));
    this.ctx.globalAlpha = progress;
    this.ctx.translate(-width / 2, -height / 2);
    this.ctx.drawImage(toFrame, 0, 0);
    this.ctx.restore();

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 溶解转场
 * 像素级别的随机过渡效果
 */
export class DissolveTransition extends BaseTransition {
  name = 'dissolve';
  defaultDuration = 2e6;
  defaultConfig = {
    blockSize: 1,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private toCanvas: OffscreenCanvas;
  private toCtx: OffscreenCanvasRenderingContext2D;
  private noisePattern: Uint8Array | null = null;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
    this.toCanvas = new OffscreenCanvas(1, 1);
    this.toCtx = this.toCanvas.getContext('2d')!;
  }

  /**
   * 生成噪声图案用于溶解效果
   */
  private generateNoisePattern(width: number, height: number): Uint8Array {
    const size = width * height;
    const pattern = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      pattern[i] = Math.floor(Math.random() * 256);
    }
    return pattern;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { blockSize = 1 } = config;
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;

    this.canvas.width = width;
    this.canvas.height = height;
    this.toCanvas.width = width;
    this.toCanvas.height = height;

    // 生成或重用噪声图案
    if (!this.noisePattern || this.noisePattern.length !== width * height) {
      this.noisePattern = this.generateNoisePattern(width, height);
    }

    // 绘制两帧到画布
    this.ctx.drawImage(fromFrame, 0, 0);
    this.toCtx.drawImage(toFrame, 0, 0);

    const fromImageData = this.ctx.getImageData(0, 0, width, height);
    const toImageData = this.toCtx.getImageData(0, 0, width, height);
    const fromData = fromImageData.data;
    const toData = toImageData.data;

    const threshold = progress * 255;

    // 基于噪声图案进行像素级溶解
    if (blockSize <= 1) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const pixelIdx = idx * 4;

          if (this.noisePattern[idx] < threshold) {
            fromData[pixelIdx] = toData[pixelIdx];         // R
            fromData[pixelIdx + 1] = toData[pixelIdx + 1]; // G
            fromData[pixelIdx + 2] = toData[pixelIdx + 2]; // B
            fromData[pixelIdx + 3] = toData[pixelIdx + 3]; // A
          }
        }
      }
    } else {
      // 块状溶解效果
      for (let y = 0; y < height; y += blockSize) {
        for (let x = 0; x < width; x += blockSize) {
          const idx = y * width + x;
          if (this.noisePattern[idx] < threshold) {
            for (let by = 0; by < blockSize && y + by < height; by++) {
              for (let bx = 0; bx < blockSize && x + bx < width; bx++) {
                const pixelIdx = ((y + by) * width + (x + bx)) * 4;
                fromData[pixelIdx] = toData[pixelIdx];
                fromData[pixelIdx + 1] = toData[pixelIdx + 1];
                fromData[pixelIdx + 2] = toData[pixelIdx + 2];
                fromData[pixelIdx + 3] = toData[pixelIdx + 3];
              }
            }
          }
        }
      }
    }

    this.ctx.putImageData(fromImageData, 0, 0);
    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.toCanvas.width = 0;
    this.toCanvas.height = 0;
    this.noisePattern = null;
  }
}

/**
 * 擦除转场
 * 像擦除一样从一边擦到另一边
 */
export class WipeTransition extends BaseTransition {
  name = 'wipe';
  defaultDuration = 2e6;
  defaultConfig = {
    direction: 'left',
    softEdge: 0,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { direction = 'left', softEdge = 0 } = config as { direction?: SlideDirection; softEdge?: number };
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    // 先绘制结束帧作为底层
    this.ctx.drawImage(toFrame, 0, 0);

    // 创建裁剪区域绘制起始帧
    this.ctx.save();
    this.ctx.beginPath();

    switch (direction) {
      case 'left':
        this.ctx.rect(width * progress, 0, width * (1 - progress), height);
        break;
      case 'right':
        this.ctx.rect(0, 0, width * (1 - progress), height);
        break;
      case 'up':
        this.ctx.rect(0, height * progress, width, height * (1 - progress));
        break;
      case 'down':
        this.ctx.rect(0, 0, width, height * (1 - progress));
        break;
    }

    this.ctx.clip();

    // 如果有柔边效果，添加渐变遮罩
    if (softEdge > 0) {
      this.ctx.globalAlpha = 1;
    }

    this.ctx.drawImage(fromFrame, 0, 0);
    this.ctx.restore();

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 圆形扩展转场
 * 从中心向外或从外向中心的圆形过渡
 */
export class CircleTransition extends BaseTransition {
  name = 'circle';
  defaultDuration = 2e6;
  defaultConfig = {
    direction: 'in',
    centerX: 0.5,
    centerY: 0.5,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { direction = 'in', centerX = 0.5, centerY = 0.5 } = config;
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    // 计算最大半径（对角线长度）
    const maxRadius = Math.sqrt(width * width + height * height) / 2;
    const cx = width * centerX;
    const cy = height * centerY;

    if (direction === 'in') {
      // 从外向内：先绘制toFrame，然后在圆形区域内绘制fromFrame
      this.ctx.drawImage(toFrame, 0, 0);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, maxRadius * (1 - progress), 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(fromFrame, 0, 0);
      this.ctx.restore();
    } else {
      // 从内向外：先绘制fromFrame，然后在圆形区域内绘制toFrame
      this.ctx.drawImage(fromFrame, 0, 0);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, maxRadius * progress, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(toFrame, 0, 0);
      this.ctx.restore();
    }

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 模糊转场
 * 前一帧逐渐模糊淡出，后一帧从模糊逐渐清晰
 */
export class BlurTransition extends BaseTransition {
  name = 'blur';
  defaultDuration = 2e6;
  defaultConfig = {
    maxBlur: 20,
  };

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  async apply(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    config: TransitionConfig
  ): Promise<VideoFrame> {
    const { maxBlur = 20 } = config;
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx.clearRect(0, 0, width, height);

    // 前一帧：清晰 -> 模糊
    const fromBlur = progress * maxBlur;
    // 后一帧：模糊 -> 清晰
    const toBlur = (1 - progress) * maxBlur;

    // 绘制起始帧（模糊效果）
    this.ctx.save();
    this.ctx.filter = `blur(${fromBlur}px)`;
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.drawImage(fromFrame, 0, 0);
    this.ctx.restore();

    // 绘制结束帧（模糊效果）
    this.ctx.save();
    this.ctx.filter = `blur(${toBlur}px)`;
    this.ctx.globalAlpha = progress;
    this.ctx.drawImage(toFrame, 0, 0);
    this.ctx.restore();

    this.ctx.filter = 'none';

    return this.createVideoFrame(this.canvas, fromFrame.timestamp, fromFrame.duration ?? undefined);
  }

  dispose(): void {
    super.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
