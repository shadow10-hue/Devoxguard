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
    <header class="page-header">
      <span class="eyebrow">Live posture</span>
      <h1>Overview</h1>
      <p class="lede">Real-time signal from the DevoxGuard engine — what it blocked, which rules fired, and how anomaly pressure is trending.</p>
    </header>

    <LoadingSkeleton v-if="loading" variant="stat" />
    <ErrorState v-else-if="error" :message="error" />

    <div v-else-if="stats" class="overview-grid">
      <StatCard label="Blocked requests (24h)" :value="stats.blockedLast24h" :icon="ShieldOff" tone="danger" />

      <div class="card">
        <h2>Top rules triggered</h2>
        <ol v-if="stats.topRulesTriggered.length" class="rule-list">
          <li v-for="(rule, i) in stats.topRulesTriggered" :key="rule.ruleName">
            <span class="rule-rank">{{ i + 1 }}</span>
            <code>{{ rule.ruleName }}</code>
            <span class="rule-count">{{ rule.count }}</span>
          </li>
        </ol>
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
  gap: var(--space-1);
}
.rule-list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-2);
  margin: 0 calc(-1 * var(--space-2));
  border-radius: var(--radius-sm);
  transition: background-color var(--dur) var(--ease);
}
.rule-list li:hover {
  background: var(--surface-hover);
}
.rule-rank {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: var(--accent-bg);
}
.rule-list code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rule-count {
  margin-left: auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-h);
}
</style>
