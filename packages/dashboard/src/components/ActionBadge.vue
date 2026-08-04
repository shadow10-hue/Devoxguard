<script setup lang="ts">
import { computed } from 'vue';
import { Ban, Clock, FileText } from '@lucide/vue';
import Badge from './Badge.vue';
import { normalizeAction } from '../lib/badge-mappings';

const props = defineProps<{
  action: string;
}>();

const normalized = computed(() => normalizeAction(props.action));

const icon = computed(() => {
  if (normalized.value.tone === 'danger') return Ban;
  if (normalized.value.tone === 'warning') return Clock;
  if (normalized.value.tone === 'info') return FileText;
  return undefined;
});
</script>

<template>
  <Badge :tone="normalized.tone" :label="normalized.label" :icon="icon" />
</template>
