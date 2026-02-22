/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 模块声明
declare module 'audiobuffer-to-wav';
declare module 'vue3-draggable';
