<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { NProgress, NButton, NIcon, NTag, NCollapse, NCollapseItem, NInput, NSlider } from 'naive-ui';
import { Dismiss20Regular } from '@vicons/fluent';
import AiIntentForm from './ai-intent-form.vue';
import type { AiPhase, VideoMeta } from '../../hooks/ai-pipeline';
import type { AnalysisOptions, JobProgress, SoundDesignResult, GeneratedTrack } from '../../services/ai-client';

const props = defineProps<{
  phase: AiPhase;
  videoMeta: VideoMeta | null;
  lastOptions: AnalysisOptions;
  showSettings: boolean;
  isProcessing: boolean;
  progress: number;
  stage: string;
  message: string;
  events: JobProgress[];
  error: string | null;
  result: SoundDesignResult | null;
  jobId: string | null;
  regeneratingTrackId: string | null;
  selectedAiTrack: GeneratedTrack | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'submit', options: AnalysisOptions): void;
  (e: 'skip'): void;
  (e: 'regenerate'): void;
  (e: 'adjustSettings'): void;
  (e: 'backToResults'): void;
  (e: 'adjustSpeed', trackId: string, rate: number): void;
  (e: 'extendTrack', trackId: string, durationSec: number): void;
  (e: 'regenerateTrack', trackId: string, prompt: string): void;
  (e: 'adjustVolume', trackId: string, volume: number): void;
  (e: 'selectTrack', trackId: string): void;
}>();

// Panel view mode
type PanelView = 'summary' | 'sfx-edit' | 'music-readonly';
const panelView = computed<PanelView>(() => {
  const track = props.selectedAiTrack;
  if (!track) return 'summary';
  if (track.type === 'music') return 'music-readonly';
  return 'sfx-edit';
});

// Volume slider (local ref synced to selected track)
const localVolume = ref(1);
const isSyncingVolume = ref(false);

watch(() => props.selectedAiTrack, (track) => {
  if (!track) return;
  isSyncingVolume.value = true;
  localVolume.value = track.volume ?? 1;
  nextTick(() => { isSyncingVolume.value = false; });
}, { immediate: true });

watch(localVolume, (v) => {
  if (isSyncingVolume.value || !props.selectedAiTrack) return;
  emit('adjustVolume', props.selectedAiTrack.id, v);
});

// Prompt editing
const editedPrompt = ref('');

watch(() => props.selectedAiTrack, (track) => {
  if (!track || track.type === 'music') { editedPrompt.value = ''; return; }
  editedPrompt.value = track.prompt || track.label.replace(/^(SFX|Ambient):\s*/i, '');
});

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
    ambient: tracks.filter(t => t.type === 'ambient').length,
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
    ambientSegments: soundDesignPlan.ambient_segments?.length ?? 0,
    skipped: soundDesignPlan.music_segments.filter(s => s.skip).length,
    globalStyle: soundDesignPlan.global_music_style,
  };
});

const generationHealth = computed(() => {
  if (!props.result?.generationReport) return null;
  const r = props.result.generationReport;
  return {
    totalFallback: r.sfx.stats.fallback + r.ambient.stats.fallback + r.music.stats.fallback,
    totalFailed: r.sfx.stats.failed + r.ambient.stats.failed + r.music.stats.failed,
  };
});

const hasOptionsEcho = computed(() => {
  const o = props.lastOptions;
  return o.creativeDirection || o.useExistingAudio;
});

function formatTimeRange(startSec: number, durationSec: number): string {
  return `${startSec.toFixed(1)}s - ${(startSec + durationSec).toFixed(1)}s`;
}

function trackTagType(track: GeneratedTrack) {
  if (track.skip) return 'default' as const;
  if (track.type === 'sfx') return 'info' as const;
  if (track.type === 'ambient') return 'warning' as const;
  return 'success' as const;
}
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
      <!-- Settings overlay (shown when user clicks Adjust Settings) -->
      <template v-if="showSettings && videoMeta">
        <button class="back-to-results-btn" @click="emit('backToResults')">
          &larr; Back to Results
        </button>
        <AiIntentForm
          :video-meta="videoMeta"
          :initial-options="lastOptions"
          @submit="emit('submit', $event)"
          @skip="emit('skip')"
        />
      </template>

      <!-- Normal results view -->
      <template v-else>
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

        <div class="panel-view" v-if="result">

          <!-- ═══ SUMMARY VIEW ═══ -->
          <template v-if="panelView === 'summary'">
            <p class="summary-hint">Select a track on the timeline to edit</p>

            <div class="summary-counts" v-if="trackSummary">
              <n-tag type="success" size="small">{{ trackSummary.music }} music</n-tag>
              <n-tag v-if="trackSummary.ambient > 0" type="warning" size="small">{{ trackSummary.ambient }} ambient</n-tag>
              <n-tag v-if="trackSummary.sfx > 0" type="info" size="small">{{ trackSummary.sfx }} SFX</n-tag>
              <n-tag v-if="trackSummary.skipped > 0" type="default" size="small">{{ trackSummary.skipped }} silent</n-tag>
            </div>

            <div class="summary-health" v-if="generationHealth && (generationHealth.totalFallback > 0 || generationHealth.totalFailed > 0)">
              <p v-if="generationHealth.totalFallback > 0" class="summary-health-item summary-health-item--warn">
                {{ generationHealth.totalFallback }} track(s) recovered via fallback
              </p>
              <p v-if="generationHealth.totalFailed > 0" class="summary-health-item summary-health-item--error">
                {{ generationHealth.totalFailed }} track(s) failed to generate
              </p>
            </div>

            <div class="summary-track-list">
              <div
                v-for="track in result.tracks"
                :key="track.id"
                class="summary-track-item"
                @click="!track.skip && emit('selectTrack', track.id)"
                :class="{ 'summary-track-item--clickable': !track.skip }"
              >
                <n-tag :type="trackTagType(track)" size="small">
                  {{ track.skip ? 'silent' : track.type }}
                </n-tag>
                <span class="track-label">{{ track.label }}</span>
                <span class="track-duration">{{ track.actualDurationSec.toFixed(1) }}s</span>
                <n-tag v-if="track.loop" size="tiny" type="info">loop</n-tag>
              </div>
            </div>

            <!-- Generation Details collapsed -->
            <n-collapse class="generation-details-collapse">
              <n-collapse-item title="Generation Details" name="details">
                <div class="result-grid" v-if="storySummary">
                  <div class="result-item">
                    <span class="result-label">Genre</span>
                    <span class="result-value">{{ storySummary.genre }}</span>
                  </div>
                  <div class="result-item">
                    <span class="result-label">Setting</span>
                    <span class="result-value">{{ storySummary.setting }}</span>
                  </div>
                  <div class="result-item">
                    <span class="result-label">Story Beats</span>
                    <span class="result-value">{{ storySummary.beats }}</span>
                  </div>
                  <div class="result-item">
                    <span class="result-label">Speech Segments</span>
                    <span class="result-value">{{ storySummary.speechSegments }}</span>
                  </div>
                </div>
                <div class="result-detail" v-if="storySummary?.emotionalArc">
                  <span class="result-label">Emotional Arc</span>
                  <p class="result-description">{{ storySummary.emotionalArc }}</p>
                </div>
                <div class="result-grid" v-if="designSummary" style="margin-top: 12px;">
                  <div class="result-item">
                    <span class="result-label">Scenes</span>
                    <span class="result-value">{{ designSummary.scenes }}</span>
                  </div>
                  <div class="result-item">
                    <span class="result-label">Music Segments</span>
                    <span class="result-value">{{ designSummary.musicSegments }}</span>
                  </div>
                  <div class="result-item" v-if="designSummary.ambientSegments > 0">
                    <span class="result-label">Ambient Segments</span>
                    <span class="result-value">{{ designSummary.ambientSegments }}</span>
                  </div>
                  <div class="result-item" v-if="designSummary.globalStyle">
                    <span class="result-label">Style</span>
                    <span class="result-value">{{ designSummary.globalStyle }}</span>
                  </div>
                </div>
              </n-collapse-item>
            </n-collapse>
          </template>

          <!-- ═══ SFX / AMBIENT EDIT CARD ═══ -->
          <template v-else-if="panelView === 'sfx-edit' && selectedAiTrack">
            <div class="track-card-header">
              <n-tag :type="trackTagType(selectedAiTrack)" size="small">
                {{ selectedAiTrack.type }}
              </n-tag>
              <span class="track-card-title">{{ selectedAiTrack.label }}</span>
            </div>

            <div class="track-card-meta">
              <span>{{ formatTimeRange(selectedAiTrack.startTimeSec, selectedAiTrack.requestedDurationSec) }}</span>
              <n-tag v-if="selectedAiTrack.loop" size="tiny" type="info">loop</n-tag>
            </div>

            <div class="track-card-section" v-if="selectedAiTrack.prompt">
              <span class="track-card-section-label">Original prompt</span>
              <p class="track-card-section-text">{{ selectedAiTrack.prompt }}</p>
            </div>

            <div class="track-card-section">
              <span class="track-card-section-label">Speed</span>
              <div class="track-card-buttons">
                <n-button size="tiny" quaternary @click="emit('adjustSpeed', selectedAiTrack.id, 0.75)">0.75x</n-button>
                <n-button size="tiny" quaternary @click="emit('adjustSpeed', selectedAiTrack.id, 1)">1x</n-button>
                <n-button size="tiny" quaternary @click="emit('adjustSpeed', selectedAiTrack.id, 1.25)">1.25x</n-button>
              </div>
            </div>

            <div class="track-card-section">
              <span class="track-card-section-label">Extend</span>
              <div class="track-card-buttons">
                <n-button size="tiny" quaternary @click="emit('extendTrack', selectedAiTrack.id, selectedAiTrack.requestedDurationSec * 1.5)">1.5x</n-button>
                <n-button size="tiny" quaternary @click="emit('extendTrack', selectedAiTrack.id, selectedAiTrack.requestedDurationSec * 2)">2x</n-button>
                <n-button size="tiny" quaternary @click="emit('extendTrack', selectedAiTrack.id, selectedAiTrack.requestedDurationSec * 3)">3x</n-button>
              </div>
            </div>

            <div class="track-card-volume">
              <span class="track-card-section-label">Volume</span>
              <n-slider
                v-model:value="localVolume"
                :min="0"
                :max="4"
                :step="0.01"
                :tooltip="true"
                :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
              />
            </div>

            <div class="track-card-section track-card-section--prompt">
              <span class="track-card-section-label">Prompt</span>
              <n-input
                v-model:value="editedPrompt"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 4 }"
                size="small"
                placeholder="Describe the sound..."
              />
              <n-button
                size="small"
                type="primary"
                :disabled="!editedPrompt.trim() || regeneratingTrackId === selectedAiTrack.id"
                :loading="regeneratingTrackId === selectedAiTrack.id"
                @click="emit('regenerateTrack', selectedAiTrack.id, editedPrompt.trim())"
              >
                Regenerate
              </n-button>
            </div>
          </template>

          <!-- ═══ MUSIC READ-ONLY CARD ═══ -->
          <template v-else-if="panelView === 'music-readonly' && selectedAiTrack">
            <div class="track-card-header">
              <n-tag type="success" size="small">music</n-tag>
              <span class="track-card-title">{{ selectedAiTrack.label }}</span>
            </div>

            <div class="track-card-meta">
              <span>{{ formatTimeRange(selectedAiTrack.startTimeSec, selectedAiTrack.requestedDurationSec) }}</span>
              <n-tag v-if="selectedAiTrack.loop" size="tiny" type="info">loop</n-tag>
            </div>

            <div class="track-card-meta" v-if="selectedAiTrack.genre || selectedAiTrack.style">
              <span v-if="selectedAiTrack.genre" class="track-card-meta-item">
                <span class="track-card-section-label">Genre:</span> {{ selectedAiTrack.genre }}
              </span>
              <span v-if="selectedAiTrack.style" class="track-card-meta-item">
                <span class="track-card-section-label">Style:</span> {{ selectedAiTrack.style }}
              </span>
            </div>

            <div class="track-card-volume">
              <span class="track-card-section-label">Volume</span>
              <n-slider
                v-model:value="localVolume"
                :min="0"
                :max="4"
                :step="0.01"
                :tooltip="true"
                :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
              />
            </div>

            <p class="music-regenerate-notice">
              Music tracks are generated together. Use Regenerate All below.
            </p>
          </template>
        </div>

        <div class="complete-actions">
          <n-button size="small" @click="emit('regenerate')">Regenerate All</n-button>
          <button class="adjust-settings-btn" @click="emit('adjustSettings')">Adjust Settings</button>
        </div>
      </template>
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

.back-to-results-btn {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 12px;
  color: var(--webcut-text-primary);
  opacity: 0.6;
  cursor: pointer;
  text-align: left;
}

.back-to-results-btn:hover {
  opacity: 1;
}

/* ─── Panel View (replaces old results-section) ─── */

.panel-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ─── Summary View ─── */

.summary-hint {
  margin: 0;
  font-size: 12px;
  opacity: 0.5;
  color: var(--webcut-text-primary);
  font-style: italic;
}

.summary-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.summary-health {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-health-item {
  margin: 0;
  font-size: 11px;
  color: var(--webcut-text-primary);
}

.summary-health-item--warn {
  opacity: 0.7;
}

.summary-health-item--error {
  color: #e53e3e;
}

.summary-track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-track-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  margin: 0 -6px;
  font-size: 12px;
  border-radius: 4px;
}

.summary-track-item--clickable {
  cursor: pointer;
}

.summary-track-item--clickable:hover {
  background: rgba(128, 128, 128, 0.08);
}

.generation-details-collapse {
  margin-top: 4px;
}

/* ─── Track Edit Card (SFX + Music) ─── */

.track-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.track-card-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--webcut-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.track-card-meta-item {
  font-size: 12px;
  color: var(--webcut-text-primary);
}

.track-card-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.track-card-section--prompt {
  gap: 6px;
}

.track-card-section-label {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.track-card-section-text {
  margin: 0;
  font-size: 12px;
  opacity: 0.8;
  color: var(--webcut-text-primary);
  line-height: 1.4;
}

.track-card-buttons {
  display: flex;
  gap: 4px;
}

.track-card-volume {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.music-regenerate-notice {
  margin: 0;
  font-size: 11px;
  opacity: 0.5;
  color: var(--webcut-text-primary);
  font-style: italic;
}

/* ─── Shared ─── */

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
