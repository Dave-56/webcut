/**
 * 帧缓存系统
 * 实现高效的帧缓存管理，支持 LRU 策略和预缓存关键帧
 */

export interface FrameCacheConfig {
  /** 最大缓存大小（字节），默认 100MB */
  maxSize?: number;
  /** 每个 source 最大缓存帧数，默认 10 */
  maxFramesPerSource?: number;
  /** 缓存过期时间（毫秒），默认 30 秒 */
  expireTime?: number;
}

interface CachedFrame {
  /** 缓存的帧数据（ImageBitmap 比 VideoFrame 更适合缓存） */
  bitmap: ImageBitmap;
  /** 缓存时间戳 */
  cachedAt: number;
  /** 帧宽度 */
  width: number;
  /** 帧高度 */
  height: number;
  /** 估算大小（字节） */
  size: number;
}

interface SourceCache {
  /** 帧缓存，key 为位置标识（'start' | 'end' | 时间戳） */
  frames: Map<string, CachedFrame>;
  /** 最近访问时间列表，用于 LRU */
  accessOrder: string[];
}

export class FrameCache {
  private cache: Map<string, SourceCache> = new Map();
  private config: Required<FrameCacheConfig>;
  private totalSize: number = 0;

  constructor(config: FrameCacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100 * 1024 * 1024, // 100MB
      maxFramesPerSource: config.maxFramesPerSource ?? 10,
      expireTime: config.expireTime ?? 30000, // 30 秒
    };
  }

  /**
   * 获取缓存的帧
   * @param sourceKey source 标识
   * @param position 位置标识（'start' | 'end' | 时间戳字符串）
   * @returns ImageBitmap 或 null
   */
  getFrame(sourceKey: string, position: string): ImageBitmap | null {
    const sourceCache = this.cache.get(sourceKey);
    if (!sourceCache) {
      return null;
    }

    const cachedFrame = sourceCache.frames.get(position);
    if (!cachedFrame) {
      return null;
    }

    // 检查是否过期
    const now = Date.now();
    if (now - cachedFrame.cachedAt > this.config.expireTime) {
      this.removeFrame(sourceKey, position);
      return null;
    }

    // 更新访问顺序（LRU）
    this.updateAccessOrder(sourceCache, position);

    return cachedFrame.bitmap;
  }

  /**
   * 从缓存的 ImageBitmap 创建 VideoFrame
   * @param sourceKey source 标识
   * @param position 位置标识
   * @param timestamp VideoFrame 的时间戳
   * @returns VideoFrame 或 null
   */
  getVideoFrame(sourceKey: string, position: string, timestamp: number): VideoFrame | null {
    const bitmap = this.getFrame(sourceKey, position);
    if (!bitmap) {
      return null;
    }

    return new VideoFrame(bitmap, { timestamp });
  }

  /**
   * 缓存帧数据
   * @param sourceKey source 标识
   * @param position 位置标识
   * @param frame VideoFrame 或 ImageBitmap
   */
  async cacheFrame(
    sourceKey: string,
    position: string,
    frame: VideoFrame | ImageBitmap
  ): Promise<void> {
    // 如果是 VideoFrame，转换为 ImageBitmap
    let bitmap: ImageBitmap;
    if (frame instanceof VideoFrame) {
      bitmap = await createImageBitmap(frame);
    } else {
      bitmap = frame;
    }

    const width = bitmap.width;
    const height = bitmap.height;
    // 估算大小：RGBA 每像素 4 字节
    const size = width * height * 4;

    // 确保有足够空间
    this.ensureSpace(size);

    // 获取或创建 source 缓存
    let sourceCache = this.cache.get(sourceKey);
    if (!sourceCache) {
      sourceCache = {
        frames: new Map(),
        accessOrder: [],
      };
      this.cache.set(sourceKey, sourceCache);
    }

    // 如果该位置已有缓存，先移除
    if (sourceCache.frames.has(position)) {
      this.removeFrame(sourceKey, position);
    }

    // 检查 source 级别的缓存限制
    while (sourceCache.frames.size >= this.config.maxFramesPerSource) {
      const oldestPosition = sourceCache.accessOrder[0];
      if (oldestPosition) {
        this.removeFrame(sourceKey, oldestPosition);
      }
    }

    // 添加新缓存
    const cachedFrame: CachedFrame = {
      bitmap,
      cachedAt: Date.now(),
      width,
      height,
      size,
    };

    sourceCache.frames.set(position, cachedFrame);
    sourceCache.accessOrder.push(position);
    this.totalSize += size;
  }

  /**
   * 预缓存 clip 的关键帧（首帧和尾帧）
   * @param sourceKey source 标识
   * @param clip MP4Clip 或 ImgClip 实例
   */
  async preCacheKeyFrames(
    sourceKey: string,
    clip: { clone: () => Promise<any>; meta: { duration: number }; ready: Promise<void> }
  ): Promise<void> {
    // 检查是否已缓存
    if (this.getFrame(sourceKey, 'start') && this.getFrame(sourceKey, 'end')) {
      return;
    }

    try {
      const { duration } = clip.meta;
      const clonedClip = await clip.clone();
      await clonedClip.ready;

      // 移除 tickInterceptor 避免递归
      clonedClip.tickInterceptor = async <T>(_: number, tickRet: T): Promise<T> => tickRet;

      // 缓存首帧
      if (!this.getFrame(sourceKey, 'start')) {
        const startRet = await clonedClip.tick(0);
        if (startRet.video) {
          await this.cacheFrame(sourceKey, 'start', startRet.video);
          startRet.video.close();
        }
      }

      // 缓存尾帧
      if (!this.getFrame(sourceKey, 'end')) {
        // 尝试获取尾帧，如果失败则尝试更早的时间
        let endTime = duration - 10;
        let endRet = await clonedClip.tick(endTime);
        if (!endRet.video) {
          endTime = duration - 1e5;
          endRet = await clonedClip.tick(endTime);
        }
        if (endRet.video) {
          await this.cacheFrame(sourceKey, 'end', endRet.video);
          endRet.video.close();
        }
      }

      clonedClip.destroy();
    } catch (e) {
      console.warn('Failed to pre-cache key frames:', e);
    }
  }

  /**
   * 移除指定帧的缓存
   */
  removeFrame(sourceKey: string, position: string): void {
    const sourceCache = this.cache.get(sourceKey);
    if (!sourceCache) {
      return;
    }

    const cachedFrame = sourceCache.frames.get(position);
    if (cachedFrame) {
      cachedFrame.bitmap.close();
      this.totalSize -= cachedFrame.size;
      sourceCache.frames.delete(position);
      sourceCache.accessOrder = sourceCache.accessOrder.filter(p => p !== position);
    }

    // 如果 source 缓存为空，移除整个 source
    if (sourceCache.frames.size === 0) {
      this.cache.delete(sourceKey);
    }
  }

  /**
   * 清除指定 source 的所有缓存
   */
  clearSource(sourceKey: string): void {
    const sourceCache = this.cache.get(sourceKey);
    if (!sourceCache) {
      return;
    }

    for (const cachedFrame of sourceCache.frames.values()) {
      cachedFrame.bitmap.close();
      this.totalSize -= cachedFrame.size;
    }

    this.cache.delete(sourceKey);
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    for (const [sourceKey] of this.cache) {
      this.clearSource(sourceKey);
    }
    this.cache.clear();
    this.totalSize = 0;
  }

  /**
   * 清理过期缓存
   */
  cleanExpired(): void {
    const now = Date.now();

    for (const [sourceKey, sourceCache] of this.cache) {
      const expiredPositions: string[] = [];

      for (const [position, cachedFrame] of sourceCache.frames) {
        if (now - cachedFrame.cachedAt > this.config.expireTime) {
          expiredPositions.push(position);
        }
      }

      for (const position of expiredPositions) {
        this.removeFrame(sourceKey, position);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    totalSize: number;
    sourceCount: number;
    frameCount: number;
    maxSize: number;
  } {
    let frameCount = 0;
    for (const sourceCache of this.cache.values()) {
      frameCount += sourceCache.frames.size;
    }

    return {
      totalSize: this.totalSize,
      sourceCount: this.cache.size,
      frameCount,
      maxSize: this.config.maxSize,
    };
  }

  /**
   * 确保有足够空间存储新帧
   */
  private ensureSpace(requiredSize: number): void {
    // 如果总大小加上新帧大小超过限制，清理最旧的缓存
    while (this.totalSize + requiredSize > this.config.maxSize && this.cache.size > 0) {
      // 找到最旧的缓存并移除
      let oldestTime = Infinity;
      let oldestSourceKey = '';
      let oldestPosition = '';

      for (const [sourceKey, sourceCache] of this.cache) {
        for (const [position, cachedFrame] of sourceCache.frames) {
          if (cachedFrame.cachedAt < oldestTime) {
            oldestTime = cachedFrame.cachedAt;
            oldestSourceKey = sourceKey;
            oldestPosition = position;
          }
        }
      }

      if (oldestSourceKey && oldestPosition) {
        this.removeFrame(oldestSourceKey, oldestPosition);
      } else {
        break;
      }
    }
  }

  /**
   * 更新访问顺序（LRU）
   */
  private updateAccessOrder(sourceCache: SourceCache, position: string): void {
    const index = sourceCache.accessOrder.indexOf(position);
    if (index > -1) {
      sourceCache.accessOrder.splice(index, 1);
    }
    sourceCache.accessOrder.push(position);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.clearAll();
  }
}

// 创建全局帧缓存实例
export const frameCache = new FrameCache();
