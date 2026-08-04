<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { devoxguardClient, type Finding } from '../api/devoxguard-client';
import SeverityBadge from '../components/SeverityBadge.vue';
import ActionBadge from '../components/ActionBadge.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import ErrorState from '../components/ErrorState.vue';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const items = ref<Finding[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const typeFilter = ref('');
const severityFilter = ref('');
const routeFilter = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const result = await devoxguardClient.getFindings({
      type: typeFilter.value || undefined,
      severity: severityFilter.value || undefined,
      route: routeFilter.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = result.items;
    total.value = result.total;
  } catch {
    error.value = 'Failed to load findings';
  } finally {
    loading.value = false;
  }
}

function goToDetail(id: string) {
  router.push({ name: 'finding-detail', params: { id } });
}

function nextPage() {
  if (page.value * pageSize.value < total.value) page.value += 1;
}

function prevPage() {
  if (page.value > 1) page.value -= 1;
}

watch([typeFilter, severityFilter, routeFilter], () => {
  page.value = 1;
  load();
});
watch(page, load);

onMounted(load);
</script>

<template>
  <section>
    <h1>Findings</h1>

    <div class="filters">
      <input v-model="typeFilter" placeholder="Filter by type…" aria-label="filter by type" />
      <select v-model="severityFilter" aria-label="filter by severity">
        <option value="">All severities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <input v-model="routeFilter" placeholder="Filter by route…" aria-label="filter by route" />
    </div>

    <LoadingSkeleton v-if="loading" variant="table" :rows="pageSize > 10 ? 10 : pageSize" />
    <ErrorState v-else-if="error" :message="error" />
    <EmptyState v-else-if="items.length === 0" title="No findings match these filters" />

    <div v-else class="card">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Severity</th>
            <th>Route</th>
            <th>Action</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="finding in items" :key="finding.id" class="row" @click="goToDetail(finding.id)">
            <td>{{ finding.type }}</td>
            <td><SeverityBadge :severity="finding.severity" /></td>
            <td><code>{{ finding.route }}</code></td>
            <td><ActionBadge :action="finding.actionTaken" /></td>
            <td class="timestamp">{{ new Date(finding.timestamp).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="page-btn" :disabled="page <= 1" @click="prevPage">
        <ChevronLeft :size="16" /> Previous
      </button>
      <span class="page-info">Page {{ page }} ({{ total }} total)</span>
      <button class="page-btn" :disabled="page * pageSize >= total" @click="nextPage">
        Next <ChevronRight :size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.filters input,
.filters select {
  font: inherit;
  font-size: 14px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-h);
}
.filters input:focus,
.filters select:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
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
.timestamp {
  color: var(--text);
  white-space: nowrap;
}
.row {
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.row:hover {
  background: var(--surface-hover);
}
.pagination {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin-top: var(--space-4);
}
.page-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-h);
  cursor: pointer;
}
.page-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}
.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-info {
  font-size: 13px;
  color: var(--text);
}
</style>
