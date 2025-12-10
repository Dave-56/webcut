<script setup lang="ts">
import { WebCutRail, WebCutTransitionData } from '../../../types';
import { computed } from 'vue';
import ContextMenu from '../../../components/context-menu/index.vue';
import { useWebCutManager } from '../../../hooks/manager';

const props = defineProps<{
    transition: WebCutTransitionData;
    rail: WebCutRail;
}>();

const { deleteTransition } = useWebCutManager();

const contextmenus = computed(() => [
  {
    label: '删除',
    key: 'delete',
  },
]);

function handleSelectContextMenu(key: string) {
  if (key === 'delete') {
    deleteTransition({ transition: props.transition, rail: props.rail });
  }
}
</script>

<template>
  <context-menu :options="contextmenus" auto-hide v-slot="{ showContextMenus }" @select="handleSelectContextMenu">
    <div
      class="webcute__manager__main__rail-transition"
      @contextmenu.capture.stop="showContextMenus"
    >
    </div>
  </context-menu>
</template>

<style scoped lang="less">
// 复用已有的 segment 样式，并添加转场特有的样式
.webcute__manager__main__rail-transition {
  width: 100%;
  height: 100%;
}
</style>
