<script setup lang="ts">
import type { ProgressRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  ProgressIndicator,
  ProgressRoot,
} from "reka-ui"
import { cn } from '../../lib/utils'

const props = withDefaults(
  defineProps<ProgressRootProps & {
    class?: HTMLAttributes["class"]
    showPercentage?: boolean
  }>(),
  {
    modelValue: 0,
  },
)

const delegatedProps = reactiveOmit(props, "class", "showPercentage")
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :class="
      cn(
        'bg-primary/20 relative h-5 w-full overflow-hidden rounded-md',
        props.class,
      )
    "
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="bg-primary h-full w-full flex-1 transition-all"
      :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
    <span
      v-if="showPercentage"
      class="absolute inset-0 flex items-center justify-center text-[11px] font-medium mix-blend-difference text-white"
    >
      {{ Math.round(props.modelValue ?? 0) }}%
    </span>
  </ProgressRoot>
</template>
