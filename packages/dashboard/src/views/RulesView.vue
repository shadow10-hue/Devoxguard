<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { devoxguardClient, type CompiledRule } from '../api/devoxguard-client';

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
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <table v-else>
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
          <td>{{ rule.nom }}</td>
          <td>{{ rule.route }}</td>
          <td>{{ rule.methode }}</td>
          <td><code>{{ rule.raw }}</code></td>
          <td>{{ rule.action }}</td>
          <td>{{ rule.severite }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
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
.error {
  color: #c0392b;
}
</style>
