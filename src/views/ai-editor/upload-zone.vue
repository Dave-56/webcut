<script setup lang="ts">
import { ref } from 'vue';
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
  <div class="flex flex-col gap-4 h-full p-4">
    <div
      class="flex-1 flex items-center justify-center border-2 border-dashed border-border rounded-xl cursor-pointer transition-all duration-200 min-h-[200px]"
      :class="{
        'border-primary bg-primary/10': isDragOver,
        'hover:border-primary hover:bg-primary/5': !disabled,
        'opacity-50 cursor-not-allowed': disabled,
      }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="handleClick"
    >
      <input
        ref="fileInput"
        type="file"
        accept="video/*"
        class="hidden"
        @change="handleFileChange"
      />
      <div class="text-center flex flex-col items-center gap-2">
        <ArrowUpload20Filled class="h-12 w-12 text-foreground opacity-40" />
        <p class="text-base font-semibold m-0 text-foreground">Drop a video here</p>
        <p class="text-[13px] m-0 text-muted-foreground">or click to browse</p>
        <p class="text-[11px] m-0 text-muted-foreground/60">MP4, MOV, WebM, AVI (max 500MB)</p>
      </div>
    </div>
  </div>
</template>
