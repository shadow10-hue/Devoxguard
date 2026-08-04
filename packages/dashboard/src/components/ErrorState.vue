<script setup lang="ts">
import { CircleAlert } from '@lucide/vue';

defineProps<{
  message: string;
}>();
</script>

<template>
  <p class="error-state" role="alert">
    <CircleAlert :size="16" :stroke-width="2" class="error-state-icon" />
    <span>{{ message }}</span>
  </p>
</template>

<style scoped>
.error-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--status-danger);
  font-size: 14px;
}
.error-state-icon {
  flex-shrink: 0;
}
</style>
