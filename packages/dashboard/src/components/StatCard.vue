<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    icon?: Component;
    tone?: 'neutral' | 'danger' | 'warning' | 'info';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <div class="stat-card card" :class="`stat-card--${tone}`">
    <div class="stat-card-icon" v-if="icon">
      <component :is="icon" :size="20" :stroke-width="2" />
    </div>
    <div class="stat-card-body">
      <span class="stat-card-label">{{ label }}</span>
      <span class="stat-card-value">{{ value }}</span>
      <div v-if="$slots.default" class="stat-card-extra"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  width: fit-content;
  min-width: 220px;
}
.stat-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  color: var(--text);
  background: var(--surface-hover);
}
.stat-card--danger .stat-card-icon {
  color: var(--status-danger);
  background: var(--status-danger-bg);
}
.stat-card--warning .stat-card-icon {
  color: var(--status-warning);
  background: var(--status-warning-bg);
}
.stat-card--info .stat-card-icon {
  color: var(--status-info);
  background: var(--status-info-bg);
}
.stat-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-card-label {
  font-size: 13px;
  color: var(--text);
}
.stat-card-value {
  font-size: 30px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.2;
}
.stat-card-extra {
  margin-top: var(--space-1);
}
</style>
