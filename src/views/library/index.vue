<script setup lang="ts">
import { ref } from 'vue';
import { NTabs, NTabPane, NIcon } from 'naive-ui';
import {
  VideoClip16Filled,
  MusicNote220Filled,
} from '@vicons/fluent';
import { useT } from '../../hooks/i18n';

// 导入素材面板组件
import VideoPanel from './video.vue';
import AudioPanel from './audio.vue';

const activeTab = ref<string>('video');
const t = useT();
</script>

<template>
  <div class="webcut-library">
    <n-tabs v-model:active-key="activeTab" :tabs-padding="8" size="small" type="line" class="webcut-library-tabs">
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
