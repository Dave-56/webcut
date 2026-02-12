<script setup lang="ts">
import { NSplit } from 'naive-ui';
import WebCutProvider from '../provider/index.vue';
import WebCutPlayerScreen from '../player/screen.vue';
import WebCutPlayerButton from '../player/button.vue';
import WebCutManager from '../manager/index.vue';
import ExportButton from '../export-button/index.vue';
import WebCutToast from '../toast/index.vue';
import UploadZone from './upload-zone.vue';
import AiStatusPanel from './ai-status-panel.vue';
import {
  useWebCutContext,
  useWebCutPlayer,
  useWebCutThemeColors,
  useWebCutDarkMode,
} from '../../hooks';
import { useWebCutLocale } from '../../hooks/i18n';
import { useAiPipeline } from '../../hooks/ai-pipeline';
import type { AnalysisOptions } from '../../services/ai-client';
import { ref } from 'vue';
import { WebCutColors } from '../../types';

const darkMode = defineModel<boolean | null | undefined>('darkMode', { default: null });
const language = defineModel<string | null | undefined>('language', { default: null });
const props = defineProps<{
  projectId?: string;
  colors?: Partial<WebCutColors>;
}>();

useWebCutContext(() => props.projectId ? { id: props.projectId } : undefined);
useWebCutThemeColors(() => props.colors);
useWebCutDarkMode(darkMode);
useWebCutLocale(language);

const { resize } = useWebCutPlayer();

const {
  isProcessing,
  progress,
  stage,
  message,
  events,
  jobId,
  error,
  result,
  videoLoaded,
  phase,
  videoMeta,
  lastOptions,
  regeneratingTrackId,
  selectedAiTrack,
  loadVideo,
  startAnalysis,
  cancel,
  adjustTrackSpeed,
  extendTrack,
  adjustTrackVolume,
  selectTrackOnTimeline,
  regenerateTrack,
} = useAiPipeline();

const manager = ref();
const showSettings = ref(false);

function handleResized() {
  manager.value?.resizeHeight();
}

function handleUpload(file: File) {
  loadVideo(file);
}
function handleIntentSubmit(options: AnalysisOptions) {
  showSettings.value = false;
  startAnalysis(options);
}
function handleIntentSkip() {
  startAnalysis();
}
function handleRegenerate() {
  showSettings.value = false;
  startAnalysis(lastOptions.value);
}
function handleAdjustSettings() {
  showSettings.value = true;
}
function handleBackToResults() {
  showSettings.value = false;
}
</script>

<template>
  <WebCutProvider>
    <div class="ai-editor">
      <div class="ai-editor-top-bar">
        <span class="ai-editor-title">AI Sound Design</span>
        <span style="flex: 1;"></span>
        <ExportButton />
      </div>
      <n-split direction="vertical" :default-size="0.75" min="300px" :max="0.85" @update:size="handleResized">
        <template #1>
          <n-split :default-size="0.65" :min="0.4" :max="0.8" @update:size="resize">
            <template #1>
              <div class="ai-editor-main">
                <UploadZone
                  v-show="!videoLoaded"
                  :disabled="isProcessing"
                  @upload="handleUpload"
                />
                <div v-show="videoLoaded" class="ai-editor-player-container">
                  <WebCutPlayerScreen class="ai-editor-player" />
                </div>
                <div v-show="videoLoaded" class="ai-editor-player-buttons">
                  <WebCutPlayerButton />
                </div>
              </div>
            </template>
            <template #2>
              <AiStatusPanel
                :phase="phase"
                :video-meta="videoMeta"
                :last-options="lastOptions"
                :show-settings="showSettings"
                :is-processing="isProcessing"
                :progress="progress"
                :stage="stage"
                :message="message"
                :events="events"
                :error="error"
                :result="result"
                :job-id="jobId"
                :regenerating-track-id="regeneratingTrackId"
                :selected-ai-track="selectedAiTrack"
                @cancel="cancel"
                @submit="handleIntentSubmit"
                @skip="handleIntentSkip"
                @regenerate="handleRegenerate"
                @adjust-settings="handleAdjustSettings"
                @back-to-results="handleBackToResults"
                @adjust-speed="adjustTrackSpeed"
                @extend-track="extendTrack"
                @regenerate-track="regenerateTrack"
                @adjust-volume="adjustTrackVolume"
                @select-track="selectTrackOnTimeline"
              />
            </template>
            <template #resize-trigger>
              <div class="ai-editor-split-trigger--vertical"></div>
            </template>
          </n-split>
        </template>
        <template #2>
          <div class="ai-editor-timeline">
            <WebCutManager ref="manager" />
          </div>
        </template>
        <template #resize-trigger>
          <div class="ai-editor-split-trigger--horizontal"></div>
        </template>
      </n-split>
    </div>
    <WebCutToast />
  </WebCutProvider>
</template>

<style scoped>
.ai-editor {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.ai-editor-top-bar {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--webcut-line-color);
  gap: 8px;
}

.ai-editor-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--webcut-text-primary);
}

.ai-editor-main {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ai-editor-player-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  width: calc(100% - 32px);
  margin: 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-editor-player {
  height: 100%;
  width: 100%;
}

.ai-editor-player-buttons {
  height: 24px;
  width: calc(100% - 32px);
  margin: 8px 16px;
  margin-top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.ai-editor-timeline {
  height: 100%;
}

.ai-editor-split-trigger--horizontal {
  width: 100%;
  height: 2px;
  background-color: var(--webcut-line-color);
}

.ai-editor-split-trigger--vertical {
  height: 100%;
  width: 2px;
  background-color: var(--webcut-line-color);
}
</style>
