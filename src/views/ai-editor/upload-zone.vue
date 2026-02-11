<script setup lang="ts">
import { ref } from 'vue';
import { NIcon } from 'naive-ui';
import { ArrowUpload20Filled } from '@vicons/fluent';

const emit = defineEmits<{
  (e: 'upload', file: File): void;
}>();

const props = defineProps<{
  disabled?: boolean;
}>();

const isDragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (!props.disabled) {
    isDragOver.value = true;
  }
}

function handleDragLeave() {
  isDragOver.value = false;
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  isDragOver.value = false;
  if (props.disabled) return;

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    processFile(files[0]);
  }
}

function handleClick() {
  if (props.disabled) return;
  fileInput.value?.click();
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    processFile(input.files[0]);
    input.value = '';
  }
}

function processFile(file: File) {
  const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg'];
  if (!videoTypes.includes(file.type)) {
    alert('Please upload a video file (MP4, MOV, WebM, AVI, or MPEG)');
    return;
  }
  emit('upload', file);
}
</script>

<template>
  <div class="upload-zone-wrapper">
    <div
      class="upload-zone"
      :class="{ 'drag-over': isDragOver, disabled }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="handleClick"
    >
      <input
        ref="fileInput"
        type="file"
        accept="video/*"
        style="display: none"
        @change="handleFileChange"
      />
      <div class="upload-zone-content">
        <n-icon :size="48" color="var(--webcut-text-primary)" style="opacity: 0.4">
          <ArrowUpload20Filled />
        </n-icon>
        <p class="upload-zone-title">Drop a video here</p>
        <p class="upload-zone-subtitle">or click to browse</p>
        <p class="upload-zone-hint">MP4, MOV, WebM, AVI (max 500MB)</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-zone-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  padding: 16px;
}

.upload-zone {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--webcut-line-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 200px;
}

.upload-zone:hover:not(.disabled) {
  border-color: var(--webcut-primary-color);
  background: rgba(var(--webcut-primary-color-rgb, 99, 102, 241), 0.05);
}

.upload-zone.drag-over {
  border-color: var(--webcut-primary-color);
  background: rgba(var(--webcut-primary-color-rgb, 99, 102, 241), 0.1);
}

.upload-zone.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upload-zone-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-zone-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--webcut-text-primary);
}

.upload-zone-subtitle {
  font-size: 13px;
  margin: 0;
  opacity: 0.6;
  color: var(--webcut-text-primary);
}

.upload-zone-hint {
  font-size: 11px;
  margin: 0;
  opacity: 0.4;
  color: var(--webcut-text-primary);
}
</style>
