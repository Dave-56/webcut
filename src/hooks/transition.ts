import { useWebCutContext, useWebCutPlayer, useWebCutHistory } from './index';
import { createRandomString } from 'ts-fns';
import { transitionPresets } from '../constants/transition';
import { WebCutTransition } from '../types';

export function useWebCutTransition() {
    const context = useWebCutContext();
    const player = useWebCutPlayer();
    const history = useWebCutHistory();
    const { rails, sources } = context;

    /**
     * 应用转场效果到两个相邻的片段
     * @param railId 轨道ID
     * @param fromSegmentIndex 起始片段索引
     * @param transitionType 转场类型
     * @param duration 转场持续时间（微秒）
     * @param params 转场参数
     */
    async function applyTransition(
        railId: string,
        fromSegmentIndex: number,
        transitionType: string,
        duration: number = 1e6,
        params: Record<string, any> = {}
    ): Promise<WebCutTransition | null> {
        const rail = rails.value.find(r => r.id === railId);
        if (!rail) return null;

        const currentSegment = rail.segments[fromSegmentIndex];
        const nextSegment = rail.segments[fromSegmentIndex + 1];
        if (!nextSegment) return null;

        // 计算转场重叠时间
        const overlapDuration = duration;

        // 调整nextSegment的start时间，使其与currentSegment重叠
        const newNextStart = currentSegment.end - overlapDuration;
        if (newNextStart < 0) return null;

        // 更新nextSegment的开始时间
        nextSegment.start = newNextStart;

        // 调整后续所有segment的start和end时间
        for (let i = fromSegmentIndex + 2; i < rail.segments.length; i++) {
            const seg = rail.segments[i];
            seg.start += overlapDuration;
            seg.end += overlapDuration;
        }

        // 创建完整的转场对象
        const preset = transitionPresets.find(p => p.key === transitionType);
        const transition: WebCutTransition = {
            id: createRandomString(16),
            type: transitionType as any,
            name: preset?.name || transitionType,
            duration: overlapDuration,
            params: { ...preset?.defaultParams, ...params },
            fromSegmentId: currentSegment.id,
            toSegmentId: nextSegment.id,
            startTime: newNextStart,
            endTime: currentSegment.end,
        };

        // 将转场对象添加到rail的transitions列表
        rail.transitions = rail.transitions || [];
        rail.transitions.push(transition);

        // 应用转场效果到sprites
        await applyTransitionToSprites(currentSegment.id, nextSegment.id, transition);

        // 保存到历史记录
        await history.push();

        return transition;
    }

    /**
     * 将转场效果应用到sprites
     * @param seg1Id 起始片段ID
     * @param seg2Id 结束片段ID
     * @param transition 转场效果配置
     */
    async function applyTransitionToSprites(
        seg1Id: string,
        seg2Id: string,
        transition: WebCutTransition
    ): Promise<void> {
        // 获取对应的sprites
        const spr1Source = [...sources.value.values()].find(source => source.segmentId === seg1Id);
        const spr2Source = [...sources.value.values()].find(source => source.segmentId === seg2Id);
        const spr1 = spr1Source?.sprite;
        const spr2 = spr2Source?.sprite;

        if (!spr1 || !spr2) return;

        // 应用具体的转场效果
        switch (transition.type) {
            case 'fade':
                applyFadeTransition(spr1, spr2, transition);
                break;
            case 'zoom':
                applyZoomTransition(spr1, spr2, transition);
                break;
            case 'slide':
                applySlideTransition(spr1, spr2, transition);
                break;
            case 'rotate':
                applyRotateTransition(spr1, spr2, transition);
                break;
            case 'dissolve':
                applyDissolveTransition(spr1, spr2, transition);
                break;
        }
    }

    /**
     * 应用淡入淡出转场效果
     */
    function applyFadeTransition(
        spr1: any,
        spr2: any,
        transition: WebCutTransition
    ): void {
        const duration = transition.duration;
        const spr1Duration = spr1.time.duration;
        const spr2Duration = spr2.time.duration;

        // 第一个视频淡出
        spr1.setAnimation(
            {
                [`${(spr1Duration - duration) / spr1Duration * 100}%`]: { opacity: 1 },
                '100%': { opacity: 0 }
            },
            {
                duration: spr1Duration,
                iterCount: 1
            }
        );

        // 第二个视频淡入
        spr2.setAnimation(
            {
                '0%': { opacity: 0 },
                [`${duration / spr2Duration * 100}%`]: { opacity: 1 }
            },
            {
                duration: spr2Duration,
                iterCount: 1
            }
        );
    }

    /**
     * 应用缩放转场效果
     */
    function applyZoomTransition(
        spr1: any,
        spr2: any,
        transition: WebCutTransition
    ): void {
        const duration = transition.duration;
        const { fromScale = 1, toScale = 1.2 } = transition.params || {};

        // 第一个视频缩小退出
        spr1.setAnimation(
            {
                '0%': { scale: 1 },
                '100%': { scale: fromScale, opacity: 0 }
            },
            { duration: spr1.time.duration }
        );

        // 第二个视频放大进入
        spr2.setAnimation(
            {
                '0%': { scale: toScale, opacity: 0 },
                '100%': { scale: 1, opacity: 1 }
            },
            { duration: spr2.time.duration }
        );
    }

    /**
     * 应用滑动转场效果
     */
    function applySlideTransition(
        spr1: any,
        spr2: any,
        transition: WebCutTransition
    ): void {
        const duration = transition.duration;
        const { direction = 'right' } = transition.params || {};

        // 第一个视频滑出
        const slideOutKeyframe: any = {
            '0%': { offsetX: 0, offsetY: 0 },
        };

        // 第二个视频滑入
        const slideInKeyframe: any = {
            '100%': { offsetX: 0, offsetY: 0 },
        };

        switch (direction) {
            case 'left':
                slideOutKeyframe['100%'] = { offsetX: -Infinity };
                slideInKeyframe['0%'] = { offsetX: Infinity };
                break;
            case 'right':
                slideOutKeyframe['100%'] = { offsetX: Infinity };
                slideInKeyframe['0%'] = { offsetX: -Infinity };
                break;
            case 'top':
                slideOutKeyframe['100%'] = { offsetY: -Infinity };
                slideInKeyframe['0%'] = { offsetY: Infinity };
                break;
            case 'bottom':
                slideOutKeyframe['100%'] = { offsetY: Infinity };
                slideInKeyframe['0%'] = { offsetY: -Infinity };
                break;
        }

        spr1.setAnimation(slideOutKeyframe, { duration: spr1.time.duration });
        spr2.setAnimation(slideInKeyframe, { duration: spr2.time.duration });
    }

    /**
     * 应用旋转转场效果
     */
    function applyRotateTransition(
        spr1: any,
        spr2: any,
        transition: WebCutTransition
    ): void {
        const duration = transition.duration;
        const { angle = 180 } = transition.params || {};

        // 第一个视频旋转退出
        spr1.setAnimation(
            {
                '0%': { rotate: 0, opacity: 1 },
                '100%': { rotate: -angle, opacity: 0 }
            },
            { duration: spr1.time.duration }
        );

        // 第二个视频旋转进入
        spr2.setAnimation(
            {
                '0%': { rotate: angle, opacity: 0 },
                '100%': { rotate: 0, opacity: 1 }
            },
            { duration: spr2.time.duration }
        );
    }

    /**
     * 应用溶解转场效果
     */
    function applyDissolveTransition(
        spr1: any,
        spr2: any,
        transition: WebCutTransition
    ): void {
        // 溶解转场的实现需要帧处理，这里暂时用透明度动画模拟
        const duration = transition.duration;
        applyFadeTransition(spr1, spr2, transition);
    }

    /**
     * 删除转场效果
     */
    async function removeTransition(railId: string, transitionId: string): Promise<void> {
        const rail = rails.value.find(r => r.id === railId);
        if (!rail) return;

        const transitionIndex = rail.transitions.findIndex(t => t.id === transitionId);
        if (transitionIndex === -1) return;

        // 删除转场
        const transition = rail.transitions.splice(transitionIndex, 1)[0];

        // 恢复segments的时间
        const currentSegment = rail.segments.find(s => s.id === transition.fromSegmentId);
        const nextSegment = rail.segments.find(s => s.id === transition.toSegmentId);
        if (!currentSegment || !nextSegment) return;

        // 恢复nextSegment的start时间
        const originalNextStart = currentSegment.end;
        const duration = transition.duration;
        nextSegment.start = originalNextStart;

        // 调整后续所有segment的start和end时间
        for (let i = rail.segments.indexOf(nextSegment) + 1; i < rail.segments.length; i++) {
            const seg = rail.segments[i];
            seg.start -= duration;
            seg.end -= duration;
        }

        // 保存到历史记录
        await history.push();
    }

    return {
        applyTransition,
        removeTransition,
        transitionPresets,
    };
}
