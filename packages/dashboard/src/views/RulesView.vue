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
    <header class="page-header">
      <span class="eyebrow">Policy</span>
      <h1>Rules</h1>
      <p class="lede">The active detection ruleset the engine evaluates on every request, loaded live from the guard.</p>
    </header>
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
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-soft);
  background: var(--surface-sunken);
  border-bottom: 1px solid var(--border);
}
td {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
tbody tr {
  transition: background-color var(--dur) var(--ease);
}
tbody tr:hover {
  background: var(--surface-hover);
}
tbody tr:last-child td {
  border-bottom: none;
}
.rule-name {
  font-weight: 600;
  color: var(--text-h);
}
</style>
