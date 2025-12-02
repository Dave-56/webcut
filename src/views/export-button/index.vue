<script setup lang="ts">
import { NButton, NIcon, useThemeVars } from 'naive-ui';
import { Export } from '@vicons/carbon';
import { useWebCutContext, useWebCutPlayer } from '../../hooks';
import { useT } from '../../libs/i18n';

const { download } = useWebCutPlayer();
const { sprites } = useWebCutContext();
const t = useT();

const themeVars = useThemeVars();
console.debug(themeVars)
</script>

<template>
    <n-button v-bind="$attrs" type="primary" size="tiny" @click="download()" :disabled="sprites.length === 0" class="webcut-editor-right-side-top-bar-export-button">
        <template #icon>
            <n-icon><Export /></n-icon>
        </template>
        <slot>{{ t('导出') }}</slot>
    </n-button>
</template>
