<script setup lang="ts">
import { computed } from 'vue';
import { NProgress, NButton, NIcon, NTag, NCollapse, NCollapseItem } from 'naive-ui';
import { Dismiss20Regular } from '@vicons/fluent';
import AiIntentForm from './ai-intent-form.vue';
import type { AiPhase, VideoMeta } from '../../hooks/ai-pipeline';
import type { AnalysisOptions, JobProgress, SoundDesignResult } from '../../services/ai-client';

const props = defineProps<{
  phase: AiPhase;
  videoMeta: VideoMeta | null;
  lastOptions: AnalysisOptions;
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
  (e: 'submit', options: AnalysisOptions): void;
  (e: 'skip'): void;
  (e: 'regenerate'): void;
  (e: 'adjustSettings'): void;
}>();

const progressPercent = computed(() => Math.round(props.progress * 100));

const stageLabel = computed(() => {
  const labels: Record<string, string> = {
    uploading: 'Uploading',
    uploading_to_gemini: 'Uploading to AI',
    analyzing_story: 'Analyzing Story',
    analyzing_sound_design: 'Planning Sound Design',
    generating: 'Generating Audio',
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
    music: tracks.filter(t => t.type === 'music' && !t.skip).length,
    sfx: tracks.filter(t => t.type === 'sfx').length,
    skipped: tracks.filter(t => t.skip).length,
    total: tracks.length,
  };
});

const storySummary = computed(() => {
  if (!props.result) return null;
  const { storyAnalysis } = props.result;
  return {
    genre: storyAnalysis.genre,
    setting: storyAnalysis.setting,
    emotionalArc: storyAnalysis.emotionalArc,
    beats: storyAnalysis.beats.length,
    speechSegments: storyAnalysis.speechSegments.length,
  };
});

const designSummary = computed(() => {
  if (!props.result) return null;
  const { soundDesignPlan } = props.result;
  return {
    scenes: soundDesignPlan.scenes.length,
    musicSegments: soundDesignPlan.music_segments.length,
    sfxSegments: soundDesignPlan.sfx_segments?.length ?? 0,
    skipped: soundDesignPlan.music_segments.filter(s => s.skip).length,
    globalStyle: soundDesignPlan.global_music_style,
  };
});

const hasOptionsEcho = computed(() => {
  const o = props.lastOptions;
  return o.creativeDirection || o.useExistingAudio;
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

    <!-- Upload Phase: Empty State -->
    <div class="empty-state" v-if="phase === 'upload'">
      <p>Upload a video to start AI sound design.</p>
      <p class="empty-hint">The AI will analyze your video and generate background music.</p>
    </div>

    <!-- Intent Phase: Form -->
    <AiIntentForm
      v-if="phase === 'intent' && videoMeta"
      :video-meta="videoMeta"
      @submit="emit('submit', $event)"
      @skip="emit('skip')"
    />

    <!-- Processing Phase -->
    <div class="progress-section" v-if="phase === 'processing'">
      <n-progress
        type="line"
        :percentage="progressPercent"
        :status="'default'"
        :indicator-placement="'inside'"
        :height="20"
        :border-radius="4"
      />
      <p class="progress-message">{{ message }}</p>

      <n-button
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

      <!-- Echo of user options -->
      <div class="options-echo" v-if="hasOptionsEcho">
        <p class="options-echo-title">Your settings</p>
        <p v-if="lastOptions.creativeDirection" class="options-echo-item">
          <span class="options-echo-label">Direction:</span> {{ lastOptions.creativeDirection }}
        </p>
        <p v-if="lastOptions.useExistingAudio" class="options-echo-item">
          <span class="options-echo-label">Audio ref:</span> Using existing audio
        </p>
      </div>
    </div>

    <!-- Error Phase -->
    <div class="error-section" v-if="phase === 'error'">
      <p class="error-message">{{ error }}</p>
      <n-button
        size="small"
        type="primary"
        @click="emit('adjustSettings')"
        style="margin-top: 8px;"
      >
        Try Again
      </n-button>
    </div>

    <!-- Complete Phase -->
    <template v-if="phase === 'complete'">
      <div class="progress-section">
        <n-progress
          type="line"
          :percentage="100"
          status="success"
          :indicator-placement="'inside'"
          :height="20"
          :border-radius="4"
        />
        <p class="progress-message">{{ message }}</p>
      </div>

      <div class="results-section" v-if="result">
        <n-collapse>
          <n-collapse-item title="Story Analysis" name="story">
            <div class="result-grid">
              <div class="result-item">
                <span class="result-label">Genre</span>
                <span class="result-value">{{ storySummary?.genre }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">Setting</span>
                <span class="result-value">{{ storySummary?.setting }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">Story Beats</span>
                <span class="result-value">{{ storySummary?.beats }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">Speech Segments</span>
                <span class="result-value">{{ storySummary?.speechSegments }}</span>
              </div>
            </div>
            <div class="result-detail" v-if="storySummary?.emotionalArc">
              <span class="result-label">Emotional Arc</span>
              <p class="result-description">{{ storySummary.emotionalArc }}</p>
            </div>
          </n-collapse-item>

          <n-collapse-item title="Sound Design Plan" name="design">
            <div class="result-grid">
              <div class="result-item">
                <span class="result-label">Scenes</span>
                <span class="result-value">{{ designSummary?.scenes }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">Music Segments</span>
                <span class="result-value">{{ designSummary?.musicSegments }}</span>
              </div>
              <div class="result-item" v-if="designSummary && designSummary.sfxSegments > 0">
                <span class="result-label">SFX Segments</span>
                <span class="result-value">{{ designSummary.sfxSegments }}</span>
              </div>
              <div class="result-item" v-if="designSummary && designSummary.skipped > 0">
                <span class="result-label">Silent Segments</span>
                <span class="result-value">{{ designSummary.skipped }}</span>
              </div>
              <div class="result-item" v-if="designSummary?.globalStyle">
                <span class="result-label">Style</span>
                <span class="result-value">{{ designSummary.globalStyle }}</span>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item title="Generated Tracks" name="tracks">
            <div class="result-grid">
              <div class="result-item">
                <span class="result-label">Music</span>
                <span class="result-value">{{ trackSummary?.music }}</span>
              </div>
              <div class="result-item" v-if="trackSummary && trackSummary.sfx > 0">
                <span class="result-label">Sound Effects</span>
                <span class="result-value">{{ trackSummary.sfx }}</span>
              </div>
              <div class="result-item" v-if="trackSummary && trackSummary.skipped > 0">
                <span class="result-label">Skipped (silent)</span>
                <span class="result-value">{{ trackSummary.skipped }}</span>
              </div>
            </div>

            <div class="track-list">
              <div
                v-for="track in result.tracks"
                :key="track.id"
                class="track-item"
              >
                <n-tag :type="track.skip ? 'default' : track.type === 'sfx' ? 'info' : 'success'" size="small">
                  {{ track.skip ? 'silent' : track.type === 'sfx' ? 'sfx' : 'music' }}
                </n-tag>
                <span class="track-label">{{ track.label }}</span>
                <span class="track-duration">{{ track.actualDurationSec.toFixed(1) }}s</span>
                <n-tag v-if="track.loop" size="tiny" type="info">loop</n-tag>
                <n-tag v-if="track.skip" size="tiny" type="warning">skip</n-tag>
              </div>
            </div>
          </n-collapse-item>
        </n-collapse>
      </div>

      <div class="complete-actions">
        <n-button size="small" @click="emit('regenerate')">Regenerate</n-button>
        <button class="adjust-settings-btn" @click="emit('adjustSettings')">Adjust Settings</button>
      </div>
    </template>

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

.options-echo {
  padding: 8px 12px;
  background: rgba(128, 128, 128, 0.08);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.options-echo-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.options-echo-item {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
  color: var(--webcut-text-primary);
}

.options-echo-label {
  font-weight: 500;
}

.complete-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.adjust-settings-btn {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 12px;
  color: var(--webcut-text-primary);
  opacity: 0.6;
  cursor: pointer;
}

.adjust-settings-btn:hover {
  opacity: 1;
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

.result-detail {
  margin-top: 4px;
}

.result-description {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: 0.8;
  color: var(--webcut-text-primary);
  line-height: 1.4;
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
