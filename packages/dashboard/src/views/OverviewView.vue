<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { devoxguardClient, type OverviewStats } from '../api/devoxguard-client';

const stats = ref<OverviewStats | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    stats.value = await devoxguardClient.getOverview();
  } catch {
    error.value = 'Failed to load overview stats';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <h1>Overview</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <div v-else-if="stats">
      <div class="stat-tile">
        <span class="label">Blocked requests (24h)</span>
        <span class="value">{{ stats.blockedLast24h }}</span>
      </div>

      <h2>Top rules triggered</h2>
      <ul v-if="stats.topRulesTriggered.length">
        <li v-for="rule in stats.topRulesTriggered" :key="rule.ruleName">
          {{ rule.ruleName }} — {{ rule.count }}
        </li>
      </ul>
      <p v-else>No rules triggered yet.</p>

      <h2>Average anomaly score trend</h2>
      <ul v-if="stats.averageAnomalyScoreTrend.length">
        <li v-for="sample in stats.averageAnomalyScoreTrend" :key="sample.timestamp">
          {{ new Date(sample.timestamp).toLocaleTimeString() }} — {{ sample.score.toFixed(2) }}
        </li>
      </ul>
      <p v-else>No anomaly data yet.</p>
    </div>
  </section>
</template>

<style scoped>
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  border: 1px solid #3333;
  border-radius: 8px;
  width: fit-content;
}
.stat-tile .label {
  font-size: 0.85rem;
  opacity: 0.7;
}
.stat-tile .value {
  font-size: 2rem;
  font-weight: 600;
}
.error {
  color: #c0392b;
}
</style>
