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
