<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { devoxguardClient, type CompiledRule } from '../api/devoxguard-client';
import SeverityBadge from '../components/SeverityBadge.vue';
import ActionBadge from '../components/ActionBadge.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import ErrorState from '../components/ErrorState.vue';
import EmptyState from '../components/EmptyState.vue';

const rules = ref<CompiledRule[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    rules.value = await devoxguardClient.getRules();
  } catch {
    error.value = 'Failed to load rules';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <h1>Rules</h1>
    <LoadingSkeleton v-if="loading" variant="table" :rows="4" />
    <ErrorState v-else-if="error" :message="error" />
    <EmptyState v-else-if="rules.length === 0" title="No rules loaded" />
    <div v-else class="card">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Route</th>
            <th>Method</th>
            <th>Condition</th>
            <th>Action</th>
            <th>Severity</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.nom">
            <td class="rule-name">{{ rule.nom }}</td>
            <td><code>{{ rule.route }}</code></td>
            <td>{{ rule.methode }}</td>
            <td><code>{{ rule.raw }}</code></td>
            <td><ActionBadge :action="rule.action" /></td>
            <td><SeverityBadge :severity="rule.severite" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 0;
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}
td {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
tbody tr:last-child td {
  border-bottom: none;
}
.rule-name {
  font-weight: 600;
  color: var(--text-h);
}
</style>
