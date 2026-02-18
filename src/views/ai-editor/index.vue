<script setup lang="ts">
import '../../styles/ai-editor.css';
import { NSplit } from 'naive-ui';
import WebCutProvider from '../provider/index.vue';
import WebCutPlayerScreen from '../player/screen.vue';
import WebCutPlayerButton from '../player/button.vue';
import WebCutManager from '../manager/index.vue';
import WebCutToast from '../toast/index.vue';
import UploadZone from './upload-zone.vue';
import AiStatusPanel from './ai-status-panel.vue';
import AiExportButton from './ai-export-button.vue';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable';
import {
  useWebCutContext,
  useWebCutPlayer,
  useWebCutThemeColors,
  useWebCutDarkMode,
} from '../../hooks';
import { useWebCutLocale } from '../../hooks/i18n';
import { useAiPipeline } from '../../hooks/ai-pipeline';
import type { AnalysisOptions } from '../../services/ai-client';
import { ref, computed } from 'vue';
import { WebCutColors } from '../../types';

const darkMode = defineModel<boolean | null | undefined>('darkMode', { default: null });
const language = defineModel<string | null | undefined>('language', { default: null });
const props = defineProps<{
  projectId?: string;
  colors?: Partial<WebCutColors>;
}>();

useWebCutContext(() => props.projectId ? { id: props.projectId } : undefined);
useWebCutThemeColors(() => props.colors);
const { isDarkMode } = useWebCutDarkMode(darkMode);
useWebCutLocale(language);

const { resize } = useWebCutPlayer();
const context = useWebCutContext();

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
  extendingTrackId,
  trackBaseDurations,
  selectedAiTrack,
  trackSourceMap,
  loadVideo,
  startAnalysis,
  cancel,
  adjustTrackSpeed,
  adjustTrackVolume,
  shortenTrack,
  extendTrack,
  selectTrackOnTimeline,
  regenerateTrack,
  regenerateDialogueLine,
} = useAiPipeline();

const manager = ref();
const showSettings = ref(false);

const trackSourceVolume = computed(() => {
  if (!selectedAiTrack.value) return 1;
  const sourceKey = trackSourceMap.value.get(selectedAiTrack.value.id);
  if (!sourceKey) return selectedAiTrack.value.volume; // fallback during re-push
  const source = context.sources.value.get(sourceKey);
  return source?.meta.audio?.volume ?? selectedAiTrack.value.volume;
});

function handleResized() {
  manager.value?.resizeHeight();
}

function handleHorizontalLayout(_sizes: number[]) {
  resize();
}

function handleUpload(file: File) {
  loadVideo(file);
}
function handleIntentSubmit(options: AnalysisOptions) {
  showSettings.value = false;
  startAnalysis(options);
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
    <div class="ai-editor relative h-full w-full flex flex-col" :class="{ dark: isDarkMode }">
      <!-- Top bar -->
      <div class="flex items-center px-3 py-1.5 border-b border-border gap-2">
        <span class="text-sm font-semibold text-foreground">AI Sound Design</span>
        <span class="flex-1"></span>
        <AiExportButton />
      </div>

      <!-- Vertical split: KEEP NSplit for pixel-based min -->
      <n-split direction="vertical" :default-size="0.75" min="300px" :max="0.85" @update:size="handleResized">
        <template #1>
          <!-- Horizontal split: USE Resizable -->
          <ResizablePanelGroup direction="horizontal" @layout="handleHorizontalLayout">
            <ResizablePanel :default-size="65" :min-size="40" :max-size="80">
              <div class="h-full flex flex-col">
                <UploadZone
                  v-show="!videoLoaded"
                  :disabled="isProcessing"
                  @upload="handleUpload"
                />
                <div v-show="videoLoaded" class="flex-1 min-h-0 overflow-hidden w-[calc(100%-32px)] mx-4 mt-4 mb-2 flex items-center justify-center">
                  <WebCutPlayerScreen class="h-full w-full" />
                </div>
                <div v-show="videoLoaded" class="h-6 w-[calc(100%-32px)] mx-4 mb-4 mt-0 flex items-center justify-center relative">
                  <WebCutPlayerButton />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle class="w-[2px] bg-border transition-colors hover:bg-primary/50 data-[resize-handle-active]:bg-primary" />
            <ResizablePanel :default-size="35">
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
                :extending-track-id="extendingTrackId"
                :track-base-durations="trackBaseDurations"
                :selected-ai-track="selectedAiTrack"
                :track-source-volume="trackSourceVolume"
                @cancel="cancel"
                @submit="handleIntentSubmit"
                @regenerate="handleRegenerate"
                @adjust-settings="handleAdjustSettings"
                @back-to-results="handleBackToResults"
                @adjust-speed="adjustTrackSpeed"
                @adjust-volume="adjustTrackVolume"
                @shorten-track="shortenTrack"
                @extend-track="extendTrack"
                @regenerate-track="regenerateTrack"
                @regenerate-dialogue-line="(id: string, text: string, emotion: string) => regenerateDialogueLine(id, text, emotion)"
                @select-track="selectTrackOnTimeline"
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </template>
        <template #2>
          <div class="h-full">
            <WebCutManager ref="manager" />
          </div>
        </template>
        <template #resize-trigger>
          <div class="h-[2px] w-full bg-border"></div>
        </template>
      </n-split>
    </div>
    <WebCutToast />
  </WebCutProvider>
</template>
