<script setup lang="ts">
import { ref, computed } from 'vue';
import { NInput, NCheckbox, NButton, NTag, NFormItem } from 'naive-ui';
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

const userIntent = ref(props.initialOptions?.userIntent ?? '');
const creativeDirection = ref(props.initialOptions?.creativeDirection ?? '');
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
  if (userIntent.value.trim()) {
    options.userIntent = userIntent.value.trim();
  }
  if (creativeDirection.value.trim()) {
    options.creativeDirection = creativeDirection.value.trim();
  }
  if (useExistingAudio.value) {
    options.useExistingAudio = true;
  }
  if (!includeSfx.value) {
    options.includeSfx = false;
  }
  emit('submit', options);
}

function handleSkip() {
  emit('skip');
}
</script>

<template>
  <div class="ai-intent-form">
    <div class="intent-meta">
      <p class="intent-meta-filename">{{ videoMeta.filename }}</p>
      <div class="intent-meta-tags">
        <n-tag size="tiny" :bordered="false">{{ formattedDuration }}</n-tag>
        <n-tag size="tiny" :bordered="false">{{ videoMeta.width }}x{{ videoMeta.height }}</n-tag>
        <n-tag size="tiny" :bordered="false">{{ videoMeta.fileSizeMB }} MB</n-tag>
      </div>
    </div>

    <n-form-item label="About This Video">
      <n-input
        v-model:value="userIntent"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 4 }"
        :maxlength="500"
        show-count
        placeholder="Describe your video or desired mood (optional) — e.g., Product launch ad for a fitness app, Wedding highlight reel, Horror short film"
      />
    </n-form-item>

    <n-form-item label="Creative Direction">
      <n-input
        v-model:value="creativeDirection"
        type="textarea"
        :rows="3"
        placeholder="e.g., Epic trailer music, Calm ambient soundscape, Cafe ambience with jazz"
      />
    </n-form-item>

    <div class="intent-checkboxes">
      <n-form-item :show-label="false" :show-feedback="false">
        <n-checkbox v-model:checked="useExistingAudio">
          Use existing audio as reference
        </n-checkbox>
      </n-form-item>
      <p class="intent-helper-text">Match the mood and tempo of the video's original audio</p>
      <n-form-item :show-label="false" :show-feedback="false">
        <n-checkbox v-model:checked="includeSfx">
          Include sound effects
        </n-checkbox>
      </n-form-item>
      <p class="intent-helper-text">Add ambient sounds and foley (door slams, rain, footsteps, etc.)</p>
    </div>

    <div class="intent-actions">
      <n-button type="primary" block @click="handleSubmit">
        Analyze & Generate Sound Design
      </n-button>
      <button class="intent-skip" @click="handleSkip">
        Skip, use smart defaults
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-intent-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.intent-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.intent-meta-filename {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--webcut-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.intent-meta-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.intent-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.intent-helper-text {
  margin: 0 0 4px 24px;
  font-size: 11px;
  opacity: 0.5;
  color: var(--webcut-text-primary);
}

.intent-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.intent-skip {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 12px;
  color: var(--webcut-text-primary);
  opacity: 0.6;
  cursor: pointer;
  text-decoration: none;
}

.intent-skip:hover {
  opacity: 1;
}
</style>
