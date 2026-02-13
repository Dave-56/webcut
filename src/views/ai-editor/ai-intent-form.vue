<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import type { AnalysisOptions } from '../../services/ai-client';
import type { VideoMeta } from '../../hooks/ai-pipeline';

const props = defineProps<{
  videoMeta: VideoMeta;
  initialOptions?: AnalysisOptions;
}>();

const emit = defineEmits<{
  (e: 'submit', options: AnalysisOptions): void;
  (e: 'skip'): void;
}>();

const prompt = ref(
  props.initialOptions?.userIntent
  ?? props.initialOptions?.creativeDirection
  ?? ''
);
const useExistingAudio = ref(props.initialOptions?.useExistingAudio ?? false);
const includeSfx = ref(props.initialOptions?.includeSfx !== false);

const formattedDuration = computed(() => {
  const sec = props.videoMeta.durationSec;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
});

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
          :checked="useExistingAudio"
          @update:checked="(v: boolean) => useExistingAudio = v"
        />
        <div class="space-y-0.5">
          <Label for="use-existing-audio" class="text-xs">Use existing audio as reference</Label>
          <p class="text-[11px] text-muted-foreground m-0">Match the mood and tempo of the video's original audio</p>
        </div>
      </div>

      <div class="flex items-start gap-2">
        <Checkbox
          id="include-sfx"
          :checked="includeSfx"
          @update:checked="(v: boolean) => includeSfx = v"
        />
        <div class="space-y-0.5">
          <Label for="include-sfx" class="text-xs">Include sound effects</Label>
          <p class="text-[11px] text-muted-foreground m-0">Ambient sounds and foley (rain, footsteps, door slams, etc.)</p>
        </div>
      </div>
    </div>

    <div class="flex flex-col items-center gap-2 mt-1">
      <Button class="w-full" @click="handleSubmit">
        Generate Sound Design
      </Button>
      <button
        class="bg-transparent border-none py-1 px-0 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        @click="emit('skip')"
      >
        Skip, use smart defaults
      </button>
    </div>
  </div>
</template>
