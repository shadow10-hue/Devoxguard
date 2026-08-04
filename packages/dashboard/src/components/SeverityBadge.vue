<script setup lang="ts">
import { computed } from 'vue';
import { ShieldAlert, ShieldCheck, TriangleAlert } from '@lucide/vue';
import Badge from './Badge.vue';

const props = defineProps<{
  severity: 'low' | 'medium' | 'high';
}>();

const icon = computed(() => {
  if (props.severity === 'high') return ShieldAlert;
  if (props.severity === 'medium') return TriangleAlert;
  return ShieldCheck;
});

const label = computed(() => props.severity.charAt(0).toUpperCase() + props.severity.slice(1));
</script>

<template>
  <Badge :tone="severity" :label="label" :icon="icon" />
</template>
