<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import type { AnalysisOptions, ContentType } from '../../services/ai-client';
import type { VideoMeta } from '../../hooks/ai-pipeline';

const CONTENT_TYPES: { id: ContentType; label: string; description: string; icon: string }[] = [
  { id: 'youtube', label: 'YouTube', description: 'Music that supports your story', icon: '\u25B6' },
  { id: 'podcast', label: 'Podcast', description: 'Intros, transitions, background beds', icon: '\uD83C\uDF99' },
  { id: 'streaming', label: 'Streaming', description: 'Low-key background for live content', icon: '\u25C9' },
  { id: 'short-form', label: 'Short-form', description: 'High energy for reels and shorts', icon: '\u26A1' },
  { id: 'film', label: 'Film & Video', description: 'Cinematic scores that elevate', icon: '\uD83C\uDFAC' },
  { id: 'commercial', label: 'Commercial', description: 'Clean, polished, brand-safe', icon: '\u2606' },
];

const props = defineProps<{
  videoMeta: VideoMeta;
  initialOptions?: AnalysisOptions;
}>();

const emit = defineEmits<{
  (e: 'submit', options: AnalysisOptions): void;
}>();

const prompt = ref(
  props.initialOptions?.userIntent
  ?? props.initialOptions?.creativeDirection
  ?? ''
);
const useExistingAudio = ref(props.initialOptions?.useExistingAudio ?? false);
const includeSfx = ref(props.initialOptions?.includeSfx !== false);
const contentType = ref<ContentType | undefined>(props.initialOptions?.contentType);

const formattedDuration = computed(() => {
  const sec = props.videoMeta.durationSec;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
});

function toggleContentType(id: ContentType) {
  contentType.value = contentType.value === id ? undefined : id;
}

function handleSubmit() {
  const options: AnalysisOptions = {};
  if (prompt.value.trim()) {
    options.userIntent = prompt.value.trim();
  }
  if (useExistingAudio.value) {
    options.useExistingAudio = true;
  }
  if (!includeSfx.value) {
    options.includeSfx = false;
  }
  if (contentType.value) {
    options.contentType = contentType.value;
  }
  emit('submit', options);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-1.5">
      <p class="m-0 text-[13px] font-medium text-foreground truncate flex-1">{{ videoMeta.filename }}</p>
      <Badge variant="secondary" class="text-[10px] px-1.5 py-0 shrink-0">{{ formattedDuration }}</Badge>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-medium text-foreground">What are you making?</Label>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="ct in CONTENT_TYPES"
          :key="ct.id"
          class="flex flex-col items-start gap-0.5 p-2 rounded-md border text-left transition-colors bg-transparent cursor-pointer"
          :class="contentType === ct.id
            ? 'border-primary bg-primary/5 text-foreground'
            : 'border-border hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground'"
          @click="toggleContentType(ct.id)"
        >
          <span class="text-sm leading-none">{{ ct.icon }}</span>
          <span class="text-[11px] font-medium leading-tight">{{ ct.label }}</span>
          <span class="text-[10px] leading-tight opacity-70">{{ ct.description }}</span>
        </button>
      </div>
      <p class="m-0 text-[10px] text-muted-foreground">Optional — helps the AI tailor sound design to your format.</p>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-medium text-foreground">What should this sound like?</Label>
      <Textarea
        v-model="prompt"
        class="min-h-[72px] text-sm"
        :maxlength="500"
        placeholder="e.g., Upbeat fitness ad — electronic music with whoosh transitions&#10;Horror short film — eerie ambient drones with sudden SFX&#10;Wedding highlight — soft piano and strings"
      />
      <p class="m-0 text-[11px] text-muted-foreground">Describe the video, desired mood, or music style. Leave blank for AI defaults.</p>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <Checkbox
          id="use-existing-audio"
          :model-value="useExistingAudio"
          @update:model-value="(v) => useExistingAudio = v === true"
        />
        <div class="space-y-0.5">
          <Label for="use-existing-audio" class="text-xs">Use existing audio as reference</Label>
          <p class="text-[11px] text-muted-foreground m-0">Match the mood and tempo of the video's original audio</p>
        </div>
      </div>

      <div class="flex items-start gap-2">
        <Checkbox
          id="include-sfx"
          :model-value="includeSfx"
          @update:model-value="(v) => includeSfx = v === true"
        />
        <div class="space-y-0.5">
          <Label for="include-sfx" class="text-xs">Include sound effects</Label>
          <p class="text-[11px] text-muted-foreground m-0">Ambient sounds and foley (rain, footsteps, door slams, etc.)</p>
        </div>
      </div>
    </div>

    <Button class="w-full mt-1" @click="handleSubmit">
      Generate Sound Design
    </Button>
  </div>
</template>
