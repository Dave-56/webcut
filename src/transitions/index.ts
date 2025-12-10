// 导入基础类和类型
import { BaseTransition, type TransitionConfig } from './base-transition';
import { TransitionManager } from './transition-manager';
// 导入转场实现
import {
  FadeTransition,
  ZoomTransition,
  SlideTransition,
  RotateTransition,
  DissolveTransition,
  WipeTransition,
  CircleTransition,
  BlurTransition,
  type SlideDirection,
} from './effect-transitions';
// 导入新的优化模块
import { FrameCache, frameCache } from './frame-cache';
import { WebGLTransitionRenderer, webglRenderer, BUILTIN_SHADERS, type TransitionShaderConfig } from './webgl-renderer';
import { GlobalTransitionManager, globalTransitionManager, type TransitionInfo, type TransitionTimeRange, type GlobalTransitionManagerConfig } from './global-transition-manager';
import { TransitionClip, type TransitionClipConfig } from './transition-clip';
import { TransitionLayer, transitionLayer, type TransitionLayerConfig, type TransitionSpriteInfo } from './transition-layer';

// 重新导出基础类和类型
export {
  BaseTransition,
  TransitionManager,
  type TransitionConfig,
  type SlideDirection,
};

// 重新导出所有转场效果类
export {
  FadeTransition,
  ZoomTransition,
  SlideTransition,
  RotateTransition,
  DissolveTransition,
  WipeTransition,
  CircleTransition,
  BlurTransition,
};

// 导出帧缓存系统
export {
  FrameCache,
  frameCache,
};

// 导出 WebGL 转场渲染器
export {
  WebGLTransitionRenderer,
  webglRenderer,
  BUILTIN_SHADERS,
  type TransitionShaderConfig,
};

// 导出全局转场管理器
export {
  GlobalTransitionManager,
  globalTransitionManager,
  type TransitionInfo,
  type TransitionTimeRange,
  type GlobalTransitionManagerConfig,
};

// 导出转场 Clip 和转场层
export {
  TransitionClip,
  type TransitionClipConfig,
  TransitionLayer,
  transitionLayer,
  type TransitionLayerConfig,
  type TransitionSpriteInfo,
};

// 创建全局转场管理器实例
export const transitionManager = new TransitionManager();

// 注册内置转场效果
transitionManager.registerTransition(new FadeTransition());
transitionManager.registerTransition(new ZoomTransition());
transitionManager.registerTransition(new SlideTransition());
transitionManager.registerTransition(new RotateTransition());
transitionManager.registerTransition(new DissolveTransition());
transitionManager.registerTransition(new WipeTransition());
transitionManager.registerTransition(new CircleTransition());
transitionManager.registerTransition(new BlurTransition());
