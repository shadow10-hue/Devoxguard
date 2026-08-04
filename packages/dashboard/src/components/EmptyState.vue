<script setup lang="ts">
import type { Component } from 'vue';
import { Inbox } from '@lucide/vue';

withDefaults(
  defineProps<{
    title: string;
    message?: string;
    icon?: Component;
  }>(),
  { icon: () => Inbox },
);
</script>

<template>
  <div class="empty-state">
    <component :is="icon" :size="28" :stroke-width="1.5" class="empty-state-icon" />
    <p class="empty-state-title">{{ title }}</p>
    <p v-if="message" class="empty-state-message">{{ message }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  color: var(--text);
}
.empty-state-icon {
  color: var(--text);
  opacity: 0.5;
}
.empty-state-title {
  font-weight: 600;
  color: var(--text-h);
}
.empty-state-message {
  font-size: 13px;
}
</style>
