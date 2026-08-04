<script setup lang="ts">
withDefaults(
  defineProps<{
    variant: 'stat' | 'table' | 'list' | 'detail';
    rows?: number;
  }>(),
  { rows: 5 },
);
</script>

<template>
  <div class="skeleton" role="status" aria-label="Loading">
    <div v-if="variant === 'stat'" class="skeleton-block skeleton-stat" />

    <table v-else-if="variant === 'table'" class="skeleton-table">
      <tbody>
        <tr v-for="row in rows" :key="row">
          <td v-for="col in 5" :key="col"><div class="skeleton-block skeleton-cell" /></td>
        </tr>
      </tbody>
    </table>

    <ul v-else-if="variant === 'list'" class="skeleton-list">
      <li v-for="row in rows" :key="row"><div class="skeleton-block skeleton-line" /></li>
    </ul>

    <div v-else class="skeleton-detail">
      <div v-for="row in rows" :key="row" class="skeleton-block skeleton-line" />
    </div>
  </div>
</template>

<style scoped>
.skeleton-block {
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton-stat {
  width: 220px;
  height: 88px;
  border-radius: var(--radius-md);
}
.skeleton-table {
  width: 100%;
  border-collapse: collapse;
}
.skeleton-table td {
  padding: var(--space-2) var(--space-3);
}
.skeleton-cell {
  height: 14px;
  width: 100%;
}
.skeleton-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.skeleton-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.skeleton-line {
  height: 14px;
  width: 60%;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>
