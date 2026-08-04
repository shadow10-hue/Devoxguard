<script setup lang="ts">
import type { Component } from 'vue';
import type { BadgeTone } from '../lib/badge-mappings';

defineProps<{
  tone: BadgeTone;
  label: string;
  icon?: Component;
}>();
</script>

<template>
  <span class="badge" :class="`badge--${tone}`">
    <component :is="icon" v-if="icon" class="badge-icon" :size="13" :stroke-width="2.5" />
    {{ label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  border: 1px solid transparent;
}
.badge-icon {
  flex-shrink: 0;
}
.badge--low {
  color: var(--severity-low);
  background: var(--severity-low-bg);
  border-color: var(--severity-low-border);
}
.badge--medium {
  color: var(--severity-medium);
  background: var(--severity-medium-bg);
  border-color: var(--severity-medium-border);
}
.badge--high {
  color: var(--severity-high);
  background: var(--severity-high-bg);
  border-color: var(--severity-high-border);
}
.badge--danger {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}
.badge--warning {
  color: var(--status-warning);
  background: var(--status-warning-bg);
  border-color: var(--status-warning-border);
}
.badge--info {
  color: var(--status-info);
  background: var(--status-info-bg);
  border-color: var(--status-info-border);
}
.badge--neutral {
  color: var(--text);
  background: var(--surface-hover);
  border-color: var(--border);
}
</style>
