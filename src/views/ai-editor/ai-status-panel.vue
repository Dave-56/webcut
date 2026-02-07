<script setup lang="ts">
import { computed } from 'vue';
import { NProgress, NButton, NIcon, NTag, NCollapse, NCollapseItem } from 'naive-ui';
import { Dismiss20Regular } from '@vicons/fluent';
import type { JobProgress, SoundDesignResult } from '../../services/ai-client';

const props = defineProps<{
  isProcessing: boolean;
  progress: number;
  stage: string;
  message: string;
  events: JobProgress[];
  error: string | null;
  result: SoundDesignResult | null;
  jobId: string | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
}>();

const progressPercent = computed(() => Math.round(props.progress * 100));

const stageLabel = computed(() => {
  const labels: Record<string, string> = {
    uploading: 'Uploading',
    extracting: 'Extracting Frames',
    analyzing: 'Analyzing Scenes',
    generating: 'Generating Audio',
    dubbing: 'Dubbing Dialogue',
    populating: 'Building Timeline',
    complete: 'Complete',
    error: 'Error',
    cancelled: 'Cancelled',
  };
  return labels[props.stage] || props.stage;
});

const stageType = computed<'success' | 'error' | 'warning' | 'info' | 'default'>(() => {
  if (props.stage === 'complete') return 'success';
  if (props.stage === 'error') return 'error';
  if (props.stage === 'cancelled') return 'warning';
  return 'info';
});

const trackSummary = computed(() => {
  if (!props.result) return null;
  const tracks = props.result.tracks;
  return {
    music: tracks.filter(t => t.type === 'music').length,
    sfx: tracks.filter(t => t.type === 'sfx').length,
    ambience: tracks.filter(t => t.type === 'ambience').length,
    dialogue: tracks.filter(t => t.type === 'dialogue').length,
    total: tracks.length,
  };
});

const sceneSummary = computed(() => {
  if (!props.result) return null;
  return {
    scenes: props.result.analysis.scenes.length,
    speechSegments: props.result.analysis.speechSegments.length,
    soundEffects: props.result.analysis.soundEffects.length,
    mood: props.result.analysis.overallMood,
  };
});
</script>

<template>
  <div class="ai-status-panel">
    <div class="panel-header">
      <h3 class="panel-title">AI Sound Design</h3>
      <n-tag :type="stageType" size="small" v-if="stage">
        {{ stageLabel }}
      </n-tag>
    </div>

    <!-- Progress Section -->
    <div class="progress-section" v-if="isProcessing || stage">
      <n-progress
        type="line"
        :percentage="progressPercent"
        :status="stage === 'error' ? 'error' : stage === 'complete' ? 'success' : 'default'"
        :indicator-placement="'inside'"
        :height="20"
        :border-radius="4"
      />
      <p class="progress-message">{{ message }}</p>

      <n-button
        v-if="isProcessing"
        size="small"
        quaternary
        type="error"
        @click="emit('cancel')"
      >
        <template #icon>
          <n-icon><Dismiss20Regular /></n-icon>
        </template>
        Cancel
      </n-button>
    </div>

    <!-- Empty State -->
    <div class="empty-state" v-if="!stage">
      <p>Upload a video to start AI sound design.</p>
      <p class="empty-hint">The AI will analyze your video and generate background music, sound effects, ambience, and optional dubbing.</p>
    </div>

    <!-- Error -->
    <div class="error-section" v-if="error">
      <p class="error-message">{{ error }}</p>
    </div>

    <!-- Results -->
    <div class="results-section" v-if="result">
      <n-collapse>
        <n-collapse-item title="Scene Analysis" name="analysis">
          <div class="result-grid">
            <div class="result-item">
              <span class="result-label">Scenes</span>
              <span class="result-value">{{ sceneSummary?.scenes }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Speech Segments</span>
              <span class="result-value">{{ sceneSummary?.speechSegments }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Sound Effects</span>
              <span class="result-value">{{ sceneSummary?.soundEffects }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Overall Mood</span>
              <span class="result-value">{{ sceneSummary?.mood }}</span>
            </div>
          </div>
        </n-collapse-item>

        <n-collapse-item title="Generated Tracks" name="tracks">
          <div class="result-grid">
            <div class="result-item">
              <span class="result-label">Music</span>
              <span class="result-value">{{ trackSummary?.music }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Sound Effects</span>
              <span class="result-value">{{ trackSummary?.sfx }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Ambience</span>
              <span class="result-value">{{ trackSummary?.ambience }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Dialogue</span>
              <span class="result-value">{{ trackSummary?.dialogue }}</span>
            </div>
          </div>

          <div class="track-list">
            <div
              v-for="track in result.tracks"
              :key="track.id"
              class="track-item"
            >
              <n-tag :type="track.type === 'music' ? 'success' : track.type === 'sfx' ? 'warning' : track.type === 'ambience' ? 'info' : 'default'" size="small">
                {{ track.type }}
              </n-tag>
              <span class="track-label">{{ track.label }}</span>
              <span class="track-duration">{{ track.actualDurationSec.toFixed(1) }}s</span>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </div>

    <!-- Event Log -->
    <div class="event-log" v-if="events.length > 0">
      <n-collapse>
        <n-collapse-item title="Activity Log" name="log">
          <div class="log-entries">
            <div
              v-for="(event, i) in events"
              :key="i"
              class="log-entry"
            >
              <span class="log-stage">{{ event.stage }}</span>
              <span class="log-message">{{ event.message }}</span>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </div>
  </div>
</template>

<style scoped>
.ai-status-panel {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--webcut-text-primary);
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-message {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
  color: var(--webcut-text-primary);
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  opacity: 0.6;
}

.empty-state p {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--webcut-text-primary);
}

.empty-hint {
  font-size: 11px !important;
  opacity: 0.7;
}

.error-section {
  padding: 8px 12px;
  background: rgba(255, 0, 0, 0.1);
  border-radius: 6px;
  border: 1px solid rgba(255, 0, 0, 0.2);
}

.error-message {
  margin: 0;
  font-size: 12px;
  color: #e53e3e;
}

.results-section {
  flex: 1;
}

.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-label {
  font-size: 11px;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.result-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--webcut-text-primary);
}

.track-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.track-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.track-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--webcut-text-primary);
}

.track-duration {
  opacity: 0.5;
  font-size: 11px;
  color: var(--webcut-text-primary);
}

.log-entries {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-entry {
  display: flex;
  gap: 8px;
  font-size: 11px;
  padding: 2px 0;
}

.log-stage {
  min-width: 80px;
  font-weight: 500;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.log-message {
  flex: 1;
  opacity: 0.7;
  color: var(--webcut-text-primary);
}

.event-log {
  margin-top: auto;
}
</style>
