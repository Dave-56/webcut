<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dismiss20Regular, ChevronRight20Regular } from '@vicons/fluent';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Textarea } from './ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
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
  extendingTrackId: string | null;
  trackBaseDurations: Map<string, number>;
  selectedAiTrack: GeneratedTrack | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'submit', options: AnalysisOptions): void;
  (e: 'regenerate'): void;
  (e: 'adjustSettings'): void;
  (e: 'backToResults'): void;
  (e: 'adjustSpeed', trackId: string, rate: number): void;
  (e: 'shortenTrack', trackId: string, durationSec: number): void;
  (e: 'extendTrack', trackId: string, durationSec: number): void;
  (e: 'regenerateTrack', trackId: string, prompt: string): void;
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

// Base duration for extend multiplier (non-compounding)
const selectedTrackBaseDuration = computed(() => {
  if (!props.selectedAiTrack) return 0;
  return props.trackBaseDurations.get(props.selectedAiTrack.id)
    ?? props.selectedAiTrack.requestedDurationSec;
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

const stageVariant = computed<'success' | 'destructive' | 'warning' | 'info' | 'secondary'>(() => {
  if (props.stage === 'complete') return 'success';
  if (props.stage === 'error') return 'destructive';
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
  return o.userIntent || o.useExistingAudio;
});

function formatTimeRange(startSec: number, durationSec: number): string {
  return `${startSec.toFixed(1)}s - ${(startSec + durationSec).toFixed(1)}s`;
}

function trackBadgeVariant(track: GeneratedTrack) {
  if (track.skip) return 'secondary' as const;
  if (track.type === 'sfx') return 'info' as const;
  if (track.type === 'ambient') return 'warning' as const;
  return 'success' as const;
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4 flex flex-col gap-4 bg-card/50 border-l border-border">
    <div class="flex items-center justify-between gap-2">
      <h3 class="m-0 text-sm font-semibold text-foreground">AI Sound Design</h3>
      <Badge :variant="stageVariant" v-if="stage">
        {{ stageLabel }}
      </Badge>
    </div>

    <!-- Upload Phase: Empty State -->
    <div class="text-center py-8 px-4" v-if="phase === 'upload'">
      <p class="m-0 mb-2 text-[13px] text-muted-foreground">Upload a video to start AI sound design.</p>
      <p class="m-0 text-[11px] text-muted-foreground/70">The AI will analyze your video and generate background music.</p>
    </div>

    <!-- Intent Phase: Form -->
    <AiIntentForm
      v-if="phase === 'intent' && videoMeta"
      :video-meta="videoMeta"
      @submit="emit('submit', $event)"
    />

    <!-- Processing Phase -->
    <div class="flex flex-col gap-2" v-if="phase === 'processing'">
      <Progress
        :model-value="progressPercent"
        show-percentage
      />
      <p class="m-0 text-xs text-muted-foreground">{{ message }}</p>

      <Button
        variant="ghost"
        size="sm"
        class="text-destructive hover:text-destructive w-fit"
        @click="emit('cancel')"
      >
        <Dismiss20Regular class="h-4 w-4 mr-1" />
        Cancel
      </Button>

      <!-- Echo of user options -->
      <div class="p-2.5 px-3 bg-muted/50 rounded-md flex flex-col gap-1" v-if="hasOptionsEcho">
        <p class="m-0 text-[11px] font-semibold text-muted-foreground">Your settings</p>
        <p v-if="lastOptions.userIntent" class="m-0 text-[11px] text-muted-foreground line-clamp-2">
          {{ lastOptions.userIntent }}
        </p>
        <p v-if="lastOptions.useExistingAudio" class="m-0 text-[11px] text-muted-foreground">
          <span class="font-medium">Audio ref:</span> Using existing audio
        </p>
      </div>
    </div>

    <!-- Error Phase -->
    <div class="p-2.5 px-3 bg-destructive/10 rounded-md border border-destructive/20" v-if="phase === 'error'">
      <p class="m-0 text-xs text-destructive">{{ error }}</p>
      <Button
        size="sm"
        class="mt-2"
        @click="emit('adjustSettings')"
      >
        Try Again
      </Button>
    </div>

    <!-- Complete Phase -->
    <template v-if="phase === 'complete'">
      <!-- Settings overlay (shown when user clicks Adjust Settings) -->
      <template v-if="showSettings && videoMeta">
        <button
          class="bg-transparent border-none py-1 px-0 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-left"
          @click="emit('backToResults')"
        >
          &larr; Back to Results
        </button>
        <AiIntentForm
          :video-meta="videoMeta"
          :initial-options="lastOptions"
          @submit="emit('submit', $event)"
            />
      </template>

      <!-- Normal results view -->
      <template v-else>
        <div class="flex flex-col gap-2">
          <Progress
            :model-value="100"
            show-percentage
          />
          <p class="m-0 text-xs text-muted-foreground">{{ message }}</p>
        </div>

        <div class="flex-1 flex flex-col gap-3" v-if="result">

          <!-- SUMMARY VIEW -->
          <template v-if="panelView === 'summary'">
            <p class="m-0 text-xs text-muted-foreground italic">Select a track on the timeline to edit</p>

            <div class="flex flex-wrap gap-1.5" v-if="trackSummary">
              <Badge variant="success">{{ trackSummary.music }} music</Badge>
              <Badge v-if="trackSummary.ambient > 0" variant="warning">{{ trackSummary.ambient }} ambient</Badge>
              <Badge v-if="trackSummary.sfx > 0" variant="info">{{ trackSummary.sfx }} SFX</Badge>
              <Badge v-if="trackSummary.skipped > 0" variant="secondary">{{ trackSummary.skipped }} silent</Badge>
            </div>

            <div class="flex flex-col gap-0.5" v-if="generationHealth && (generationHealth.totalFallback > 0 || generationHealth.totalFailed > 0)">
              <p v-if="generationHealth.totalFallback > 0" class="m-0 text-[11px] text-muted-foreground">
                {{ generationHealth.totalFallback }} track(s) recovered via fallback
              </p>
              <p v-if="generationHealth.totalFailed > 0" class="m-0 text-[11px] text-destructive">
                {{ generationHealth.totalFailed }} track(s) failed to generate
              </p>
            </div>

            <div class="flex flex-col gap-0.5">
              <div
                v-for="track in result.tracks"
                :key="track.id"
                class="flex items-center gap-2 py-1 px-1.5 -mx-1.5 text-xs rounded-md transition-colors"
                :class="{ 'cursor-pointer hover:bg-accent': !track.skip }"
                @click="!track.skip && emit('selectTrack', track.id)"
              >
                <Badge :variant="trackBadgeVariant(track)">
                  {{ track.skip ? 'silent' : track.type }}
                </Badge>
                <span class="flex-1 truncate text-foreground">{{ track.label }}</span>
                <span class="text-muted-foreground text-[11px]">{{ track.actualDurationSec.toFixed(1) }}s</span>
                <Badge v-if="track.loop" variant="info" class="text-[10px] px-1 py-0">loop</Badge>
              </div>
            </div>

            <!-- Generation Details collapsed -->
            <Collapsible class="mt-1">
              <CollapsibleTrigger class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0">
                <ChevronRight20Regular class="h-3.5 w-3.5 transition-transform duration-200 [[data-state=open]_&]:rotate-90" />
                Generation Details
              </CollapsibleTrigger>
              <CollapsibleContent class="space-y-3 pt-2">
                <div class="grid grid-cols-2 gap-2 mb-3" v-if="storySummary">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Genre</span>
                    <span class="text-sm font-semibold text-foreground">{{ storySummary.genre }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Setting</span>
                    <span class="text-sm font-semibold text-foreground">{{ storySummary.setting }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Story Beats</span>
                    <span class="text-sm font-semibold text-foreground">{{ storySummary.beats }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Speech Segments</span>
                    <span class="text-sm font-semibold text-foreground">{{ storySummary.speechSegments }}</span>
                  </div>
                </div>
                <div class="mt-1" v-if="storySummary?.emotionalArc">
                  <span class="text-[11px] text-muted-foreground">Emotional Arc</span>
                  <p class="mt-1 mb-0 text-xs text-foreground/80 leading-relaxed">{{ storySummary.emotionalArc }}</p>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-3" v-if="designSummary">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Scenes</span>
                    <span class="text-sm font-semibold text-foreground">{{ designSummary.scenes }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[11px] text-muted-foreground">Music Segments</span>
                    <span class="text-sm font-semibold text-foreground">{{ designSummary.musicSegments }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5" v-if="designSummary.ambientSegments > 0">
                    <span class="text-[11px] text-muted-foreground">Ambient Segments</span>
                    <span class="text-sm font-semibold text-foreground">{{ designSummary.ambientSegments }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5" v-if="designSummary.globalStyle">
                    <span class="text-[11px] text-muted-foreground">Style</span>
                    <span class="text-sm font-semibold text-foreground">{{ designSummary.globalStyle }}</span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </template>

          <!-- SFX / AMBIENT EDIT CARD -->
          <template v-else-if="panelView === 'sfx-edit' && selectedAiTrack">
            <div class="flex items-center gap-2">
              <Badge :variant="trackBadgeVariant(selectedAiTrack)">
                {{ selectedAiTrack.type }}
              </Badge>
              <span class="text-[13px] font-medium text-foreground truncate">{{ selectedAiTrack.label }}</span>
            </div>

            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{{ formatTimeRange(selectedAiTrack.startTimeSec, selectedAiTrack.requestedDurationSec) }}</span>
              <Badge v-if="selectedAiTrack.loop" variant="info" class="text-[10px] px-1 py-0">loop</Badge>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-muted-foreground">Speed</span>
              <div class="flex gap-1">
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('adjustSpeed', selectedAiTrack.id, 0.75)">0.75x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('adjustSpeed', selectedAiTrack.id, 1)">1x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('adjustSpeed', selectedAiTrack.id, 1.25)">1.25x</Button>
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-muted-foreground">Shorten</span>
              <div class="flex gap-1">
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('shortenTrack', selectedAiTrack.id, selectedTrackBaseDuration * 0.75)">0.75x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('shortenTrack', selectedAiTrack.id, selectedTrackBaseDuration * 0.5)">0.5x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('shortenTrack', selectedAiTrack.id, selectedTrackBaseDuration * 0.25)">0.25x</Button>
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-muted-foreground">Extend</span>
              <div class="flex gap-1">
                <Button variant="ghost" size="sm" class="h-6 text-xs" :disabled="extendingTrackId === selectedAiTrack.id" @click="emit('extendTrack', selectedAiTrack.id, selectedTrackBaseDuration * 1.5)">1.5x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" :disabled="extendingTrackId === selectedAiTrack.id" @click="emit('extendTrack', selectedAiTrack.id, selectedTrackBaseDuration * 2)">2x</Button>
                <Button variant="ghost" size="sm" class="h-6 text-xs" :disabled="extendingTrackId === selectedAiTrack.id" @click="emit('extendTrack', selectedAiTrack.id, selectedTrackBaseDuration * 3)">3x</Button>
              </div>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-[11px] font-medium text-muted-foreground">Prompt</span>
              <Textarea
                v-model="editedPrompt"
                class="min-h-[48px] text-sm"
                placeholder="Describe the sound..."
              />
              <Button
                size="sm"
                :disabled="!editedPrompt.trim() || regeneratingTrackId === selectedAiTrack.id"
                :loading="regeneratingTrackId === selectedAiTrack.id"
                @click="emit('regenerateTrack', selectedAiTrack.id, editedPrompt.trim())"
              >
                Regenerate
              </Button>
            </div>
          </template>

          <!-- MUSIC READ-ONLY CARD -->
          <template v-else-if="panelView === 'music-readonly' && selectedAiTrack">
            <div class="flex items-center gap-2">
              <Badge variant="success">music</Badge>
              <span class="text-[13px] font-medium text-foreground truncate">{{ selectedAiTrack.label }}</span>
            </div>

            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{{ formatTimeRange(selectedAiTrack.startTimeSec, selectedAiTrack.requestedDurationSec) }}</span>
              <Badge v-if="selectedAiTrack.loop" variant="info" class="text-[10px] px-1 py-0">loop</Badge>
            </div>

            <div class="flex items-center gap-2 text-xs text-foreground" v-if="selectedAiTrack.genre || selectedAiTrack.style">
              <span v-if="selectedAiTrack.genre">
                <span class="text-[11px] font-medium text-muted-foreground">Genre:</span> {{ selectedAiTrack.genre }}
              </span>
              <span v-if="selectedAiTrack.style">
                <span class="text-[11px] font-medium text-muted-foreground">Style:</span> {{ selectedAiTrack.style }}
              </span>
            </div>

            <p class="m-0 text-[11px] text-muted-foreground italic">
              Music tracks are generated together. Use Regenerate All below.
            </p>
          </template>
        </div>

        <div class="flex items-center gap-3">
          <Button variant="outline" size="sm" @click="emit('regenerate')">Regenerate All</Button>
          <button
            class="bg-transparent border-none py-1 px-0 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            @click="emit('adjustSettings')"
          >
            Adjust Settings
          </button>
        </div>
      </template>
    </template>

    <!-- Event Log -->
    <div class="mt-auto" v-if="events.length > 0">
      <Collapsible>
        <CollapsibleTrigger class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0">
          <ChevronRight20Regular class="h-3.5 w-3.5 transition-transform duration-200 [[data-state=open]_&]:rotate-90" />
          Activity Log
        </CollapsibleTrigger>
        <CollapsibleContent class="pt-2">
          <div class="max-h-[200px] overflow-y-auto flex flex-col gap-0.5">
            <div
              v-for="(event, i) in events"
              :key="i"
              class="flex gap-2 text-[11px] py-0.5"
            >
              <span class="min-w-[80px] font-medium text-muted-foreground">{{ event.stage }}</span>
              <span class="flex-1 text-muted-foreground/70">{{ event.message }}</span>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </div>
</template>
