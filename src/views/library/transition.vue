<script setup lang="ts">
import { ref, useT } from 'vue';
import { transitionPresets } from '../../constants/transition';

const isHovered = ref<string | null>(null);

const t = useT();

// 转场效果点击事件
const handleTransitionClick = (transitionKey: string) => {
  // 在实际应用中，这里应该将转场效果应用到当前选中的片段之间
  console.log('Selected transition:', transitionKey);
  // 发出事件通知父组件
  emit('select-transition', transitionKey);
};

// 定义组件事件
const emit = defineEmits<{
  'select-transition': [transitionKey: string];
}>();
</script>

<template>
  <div class="webcut-library-transition">
    <div class="webcut-library-transition-content">
      <div class="webcut-library-transition-title">
        {{ t('转场效果') }}
      </div>
      <div class="webcut-library-transition-list">
        <div
          v-for="transition in transitionPresets"
          :key="transition.key"
          class="webcut-library-transition-item"
          @click="handleTransitionClick(transition.key)"
          @mouseenter="isHovered = transition.key"
          @mouseleave="isHovered = null"
        >
          <div class="webcut-library-transition-item-icon">
            {{ transition.name.substring(0, 1) }}
          </div>
          <div class="webcut-library-transition-item-name">
            {{ transition.name }}
          </div>
          <div class="webcut-library-transition-item-duration">
            {{ (transition.defaultDuration / 1e6).toFixed(1) }}s
          </div>
          <div class="webcut-library-transition-item-description">
            {{ transition.description }}
          </div>
          <div
            v-if="isHovered === transition.key"
            class="webcut-library-transition-item-overlay"
          >
            <div class="webcut-library-transition-item-overlay-text">
              {{ t('点击应用') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.webcut-library-transition {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 12px;

  &-content {
    width: 100%;
  }

  &-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--webcut-text-color);
  }

  &-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }

  &-item {
    background: var(--webcut-background-color);
    border: 1px solid var(--webcut-grey-color);
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
    text-align: center;

    &:hover {
      border-color: var(--webcut-primary-color);
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0, 180, 162, 0.15);
    }

    &-icon {
      width: 50px;
      height: 50px;
      margin: 0 auto 12px;
      background: linear-gradient(135deg, var(--webcut-primary-color), var(--webcut-primary-color-hover));
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 600;
      transition: all 0.3s ease;
    }

    &:hover &-icon {
      transform: scale(1.1) rotate(5deg);
    }

    &-name {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--webcut-text-color);
    }

    &-duration {
      font-size: 12px;
      color: var(--webcut-primary-color);
      margin-bottom: 8px;
      font-weight: 500;
    }

    &-description {
      font-size: 12px;
      color: var(--webcut-text-color-dark);
      line-height: 1.5;
      min-height: 40px;
    }

    &-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 180, 162, 0.9);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      border-radius: 12px;

      &-text {
        font-size: 16px;
        font-weight: 600;
      }
    }

    &:hover &-overlay {
      opacity: 1;
    }
  }
}
</style>
