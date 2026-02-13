<script setup lang="ts">
import { Export } from '@vicons/carbon';
import { useWebCutContext, useWebCutPlayer } from '../../hooks';
import { useT } from '../../hooks/i18n';
import { Button } from './ui/button';

const { download } = useWebCutPlayer();
const { sprites } = useWebCutContext();
const t = useT();
</script>

<template>
  <Button
    v-bind="$attrs"
    size="sm"
    class="h-6 text-xs"
    :disabled="sprites.length === 0"
    @click="download()"
  >
    <Export class="h-3.5 w-3.5" />
    <slot>{{ t('导出') }}</slot>
  </Button>
</template>
