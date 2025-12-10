<script setup lang="ts">
import { WebCutRail, WebCutTransitionData } from '../../../types';

defineProps<{
    transition: WebCutTransitionData;
    rail: WebCutRail;
}>();

</script>

<template>
  <div class="webcute__manager__main__rail-segment webcute__manager__main__rail-segment--transition">
    <!-- 转场效果的内容展示 -->
    <div class="webcute__manager__main__rail-segment__content"></div>
  </div>
</template>

<style scoped lang="less">
// 复用已有的 segment 样式，并添加转场特有的样式
.webcute__manager__main__rail-segment--transition {
  // 添加转场特有的背景色或边框
  background-color: rgba(0, 180, 162, 0.3);

  // 禁止拖拽等交互
  pointer-events: none;

  // 可以添加一些转场特有的图标或文字样式
  color: var(--webcut-primary-color);
  font-size: var(--webcut-font-size-tiny);

  // 确保内容居中显示
  display: flex;
  align-items: center;
  justify-content: center;
}

// 转场内容样式
.webcute__manager__main__rail-segment__content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}
</style>
