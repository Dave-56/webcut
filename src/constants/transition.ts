import { WebCutTransitionType } from '../types';

/**
 * 转场效果配置
 */
export interface WebCutTransitionPreset {
    /** 预设ID */
    key: WebCutTransitionType;
    /** 预设名称（用于展示） */
    name: string;
    /** 默认持续时间（微秒） */
    defaultDuration: number;
    /** 转场效果描述 */
    description?: string;
    /** 默认参数 */
    defaultParams?: Record<string, any>;
}

/**
 * 预设转场效果
 */
export const transitionPresets: WebCutTransitionPreset[] = [
    {
        key: 'fade',
        name: '淡入淡出',
        defaultDuration: 1e6, // 1秒
        description: '平滑的淡入淡出效果',
    },
    {
        key: 'zoom',
        name: '缩放转场',
        defaultDuration: 1.5e6, // 1.5秒
        description: '通过缩放实现转场效果',
        defaultParams: {
            fromScale: 1,
            toScale: 1.2,
        },
    },
    {
        key: 'slide',
        name: '滑动转场',
        defaultDuration: 1.5e6, // 1.5秒
        description: '通过滑动实现转场效果',
        defaultParams: {
            direction: 'right',
        },
    },
    {
        key: 'rotate',
        name: '旋转转场',
        defaultDuration: 2e6, // 2秒
        description: '通过旋转实现转场效果',
        defaultParams: {
            angle: 180,
        },
    },
    {
        key: 'dissolve',
        name: '溶解转场',
        defaultDuration: 2e6, // 2秒
        description: '溶解效果转场',
    },
];
