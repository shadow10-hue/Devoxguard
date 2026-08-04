<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ShieldOff } from '@lucide/vue';
import { devoxguardClient, type OverviewStats } from '../api/devoxguard-client';
import StatCard from '../components/StatCard.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import ErrorState from '../components/ErrorState.vue';
import EmptyState from '../components/EmptyState.vue';
import AnomalyTrendChart from '../components/charts/AnomalyTrendChart.vue';

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

    <LoadingSkeleton v-if="loading" variant="stat" />
    <ErrorState v-else-if="error" :message="error" />

    <div v-else-if="stats" class="overview-grid">
      <StatCard label="Blocked requests (24h)" :value="stats.blockedLast24h" :icon="ShieldOff" tone="danger" />

      <div class="card">
        <h2>Top rules triggered</h2>
        <ul v-if="stats.topRulesTriggered.length" class="rule-list">
          <li v-for="rule in stats.topRulesTriggered" :key="rule.ruleName">
            <code>{{ rule.ruleName }}</code>
            <span class="rule-count">{{ rule.count }}</span>
          </li>
        </ul>
        <EmptyState v-else title="No rules triggered yet" />
      </div>

      <div class="card chart-card">
        <h2>Average anomaly score trend</h2>
        <AnomalyTrendChart v-if="stats.averageAnomalyScoreTrend.length" :data="stats.averageAnomalyScoreTrend" />
        <EmptyState v-else title="No anomaly data yet" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-grid {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  align-items: start;
}
.chart-card {
  grid-column: 1 / -1;
}
.rule-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.rule-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border);
}
.rule-list li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.rule-count {
  font-weight: 600;
  color: var(--text-h);
}
</style>
