<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { devoxguardClient, type Finding } from '../api/devoxguard-client';

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
      <input v-model="typeFilter" placeholder="type" aria-label="filter by type" />
      <input v-model="severityFilter" placeholder="severity" aria-label="filter by severity" />
      <input v-model="routeFilter" placeholder="route" aria-label="filter by route" />
    </div>

    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <table v-else>
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
          <td>{{ finding.severity }}</td>
          <td>{{ finding.route }}</td>
          <td>{{ finding.actionTaken }}</td>
          <td>{{ new Date(finding.timestamp).toLocaleString() }}</td>
        </tr>
      </tbody>
    </table>

    <div class="pagination">
      <button :disabled="page <= 1" @click="prevPage">Previous</button>
      <span>Page {{ page }} ({{ total }} total)</span>
      <button :disabled="page * pageSize >= total" @click="nextPage">Next</button>
    </div>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #3333;
}
.row {
  cursor: pointer;
}
.row:hover {
  background: #8882;
}
.pagination {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1rem;
}
.error {
  color: #c0392b;
}
</style>
