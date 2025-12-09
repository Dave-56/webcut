<script setup lang="ts">
import { ref } from 'vue';
import { NTabs, NTabPane, NIcon } from 'naive-ui';
import {
  VideoClip16Filled,
  MusicNote220Filled,
  Image24Filled,
  TextField24Regular,
  VideoSwitch24Filled
} from '@vicons/fluent';
import { WebCutMaterialType } from '../../types';
import { useT } from '../../hooks/i18n';
import { useWebCutContext, useWebCutTransition } from '../../hooks';

// 导入素材面板组件
import VideoPanel from './video.vue';
import AudioPanel from './audio.vue';
import ImagePanel from './image.vue';
import TextPanel from './text.vue';
import TransitionPanel from './transition.vue';

// 当前激活的 tab
const activeTab = ref<string>('video');
const t = useT();

// 获取上下文和转场管理器
const { selected, rails } = useWebCutContext();
const { applyTransition } = useWebCutTransition();

// 处理转场选择
const handleTransitionSelect = async (transitionKey: string) => {
  // 检查是否选择了两个片段
  if (selected.value.length !== 2) {
    console.warn('请选择两个相邻的片段来应用转场效果');
    return;
  }

  // 检查是否是同一轨道上的相邻片段
  const [seg1, seg2] = selected.value;

  // 如果不是同一轨道
  if (seg1.railId !== seg2.railId) {
    console.warn('请选择同一轨道上的两个相邻片段');
    return;
  }

  const rail = rails.value.find(r => r.id === seg1.railId);
  if (!rail) {
    console.warn('轨道不存在');
    return;
  }

  // 找到片段在轨道上的索引
  const seg1Index = rail.segments.findIndex(s => s.id === seg1.segmentId);
  const seg2Index = rail.segments.findIndex(s => s.id === seg2.segmentId);

  // 如果找不到片段或不是相邻片段
  if (seg1Index === -1 || seg2Index === -1 || Math.abs(seg1Index - seg2Index) !== 1) {
    console.warn('请选择两个相邻的片段');
    return;
  }

  // 确保正确的顺序 (seg1 在 seg2 之前)
  const fromSegmentIndex = Math.min(seg1Index, seg2Index);

  try {
    // 应用转场效果
    const transition = await applyTransition(seg1.railId, fromSegmentIndex, transitionKey);
    if (transition) {
      console.log('转场效果已应用');
    }
  } catch (error) {
    console.error('Failed to apply transition:', error);
  }
};

// 处理 tab 切换
const handleTabChange = (key: string) => {
  activeTab.value = key as WebCutMaterialType;
};
</script>

<template>
  <div class="webcut-library">
    <n-tabs v-model:active-key="activeTab" @update:active-key="handleTabChange" :tabs-padding="8" size="small" type="line" class="webcut-library-tabs">
      <n-tab-pane name="video">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="VideoClip16Filled"></n-icon>
                <span>{{ t('视频') }}</span>
            </div>
        </template>
        <VideoPanel />
      </n-tab-pane>
      <n-tab-pane name="audio">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="MusicNote220Filled"></n-icon>
                <span>{{ t('音频') }}</span>
            </div>
        </template>
        <AudioPanel />
      </n-tab-pane>
      <n-tab-pane name="image">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="Image24Filled"></n-icon>
                <span>{{ t('图片') }}</span>
            </div>
        </template>
        <ImagePanel />
      </n-tab-pane>
      <n-tab-pane name="text">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="TextField24Regular"></n-icon>
                <span>{{ t('文本') }}</span>
            </div>
        </template>
        <TextPanel />
      </n-tab-pane>
      <n-tab-pane name="transition">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="VideoSwitch24Filled"></n-icon>
                <span>{{ t('转场') }}</span>
            </div>
        </template>
        <TransitionPanel @select-transition="handleTransitionSelect" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped lang="less">
.webcut-library {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.webcut-library-tabs {
  height: 100%;
  overflow: hidden;

  :deep(.n-tab-pane) {
    overflow: hidden;
  }
}

.webcut-library-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    span {
        font-size: var(--webcut-font-size-tiny);
    }

    :deep(.n-icon) {
        font-size: var(--webcut-font-size-large);
    }
}
</style>
