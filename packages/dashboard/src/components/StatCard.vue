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
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  min-width: 220px;
  overflow: hidden;
  transition:
    transform var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}
/* Hairline colour rail keyed to the card's tone. */
.stat-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--border-strong);
}
.stat-card--danger::before {
  background: var(--status-danger);
}
.stat-card--warning::before {
  background: var(--status-warning);
}
.stat-card--info::before {
  background: var(--status-info);
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  border-color: var(--border-strong);
}
.stat-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  color: var(--text);
  background: var(--surface-hover);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
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
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-soft);
}
.stat-card-value {
  font-size: 38px;
  font-weight: 720;
  color: var(--text-h);
  line-height: 1.1;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
.stat-card-extra {
  margin-top: var(--space-1);
}
</style>
