<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import { Add } from '@vicons/carbon';
import { useT } from '../../hooks/i18n';
import { transitionPresets } from '../../constants/transition';
import { useWebCutContext, useWebCutTransition } from '../../hooks';
import ScrollBox from '../../components/scroll-box/index.vue';

const t = useT();

// 左侧菜单状态，只保留"默认"
const actionType = ref<'default'>('default');

// 获取上下文和转场管理器
const { selected, rails } = useWebCutContext();
const { applyTransition } = useWebCutTransition();

// 转场效果点击事件
const handleTransitionClick = async (transitionKey: string) => {
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
</script>

<template>
  <div class="webcut-library-panel">
    <!-- 左侧菜单栏 -->
    <aside class="webcut-library-panel-aside">
      <div class="webcut-library-panel-aside-btn" :class="{ 'webcut-library-panel-aside-btn--active': actionType === 'default' }">{{ t('默认') }}</div>
    </aside>

    <!-- 右侧转场列表 -->
    <main class="webcut-library-panel-main">
      <ScrollBox class="webcut-material-container">
        <div class="webcut-material-list">
          <div
            v-for="transition in transitionPresets"
            :key="transition.key"
            class="webcut-material-item"
          >
            <div class="webcut-material-preview">
              <!-- 转场效果预览图标 -->
              <div class="webcut-transition-preview-icon"></div>
              <!-- 添加按钮 -->
              <n-button 
                class="webcut-add-button" 
                size="tiny" 
                type="primary" 
                circle 
                @click.stop="handleTransitionClick(transition.key)"
              >
                <template #icon>
                  <n-icon :component="Add"></n-icon>
                </template>
              </n-button>
            </div>
            <div class="webcut-material-title">
              {{ transition.name }}
            </div>
          </div>
          <div v-if="transitionPresets.length === 0" class="webcut-empty-materials">
            {{ t('暂无转场效果') }}
          </div>
        </div>
      </ScrollBox>
    </main>
  </div>
</template>

<style scoped lang="less">
@import "../../styles/library.less";
</style>
