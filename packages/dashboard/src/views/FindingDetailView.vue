<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { devoxguardClient, type Finding, type RequestContext } from '../api/devoxguard-client';

const route = useRoute();
const finding = ref<(Finding & { requestContext: RequestContext }) | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load(id: string) {
  loading.value = true;
  error.value = null;
  try {
    finding.value = await devoxguardClient.getFinding(id);
  } catch {
    error.value = 'Failed to load finding';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(route.params.id as string));
watch(
  () => route.params.id,
  (id) => load(id as string),
);
</script>

<template>
  <section>
    <h1>Finding detail</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <div v-else-if="finding">
      <dl>
        <dt>ID</dt>
        <dd>{{ finding.id }}</dd>
        <dt>Type</dt>
        <dd>{{ finding.type }}</dd>
        <dt>Severity</dt>
        <dd>{{ finding.severity }}</dd>
        <dt>Route</dt>
        <dd>{{ finding.route }} ({{ finding.method }})</dd>
        <dt>Rule</dt>
        <dd>{{ finding.ruleName ?? '—' }}</dd>
        <dt>Action taken</dt>
        <dd>{{ finding.actionTaken }}</dd>
        <dt>Detail</dt>
        <dd>{{ finding.detail }}</dd>
        <dt>Timestamp</dt>
        <dd>{{ new Date(finding.timestamp).toLocaleString() }}</dd>
      </dl>

      <h2>Request context</h2>
      <pre>{{ JSON.stringify(finding.requestContext, null, 2) }}</pre>
    </div>
  </section>
</template>

<style scoped>
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
}
dt {
  font-weight: 600;
  opacity: 0.7;
}
pre {
  background: #8881;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
}
.error {
  color: #c0392b;
}
</style>
