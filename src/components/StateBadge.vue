<script setup lang="ts">
import type { PulseState } from "../lib/types";

const props = withDefaults(
  defineProps<{
    state: PulseState | null;
    size?: "sm" | "md" | "lg";
  }>(),
  { size: "md" },
);

const sizeClass = {
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
  lg: "text-base px-3.5 py-1.5 gap-2",
} as const;
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border font-medium"
    :class="sizeClass[props.size]"
    :style="{
      color: props.state?.color ?? '#94a3b8',
      borderColor: (props.state?.color ?? '#94a3b8') + '55',
      backgroundColor: (props.state?.color ?? '#94a3b8') + '1a',
    }"
  >
    <span v-if="props.state?.emoji">{{ props.state.emoji }}</span>
    <span>{{ props.state?.label ?? "空闲" }}</span>
  </span>
</template>
