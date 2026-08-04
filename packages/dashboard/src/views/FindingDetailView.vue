<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from '@lucide/vue';
import { devoxguardClient, type Finding, type RequestContext } from '../api/devoxguard-client';
import SeverityBadge from '../components/SeverityBadge.vue';
import ActionBadge from '../components/ActionBadge.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';
import ErrorState from '../components/ErrorState.vue';
import KeyValueTree from '../components/KeyValueTree.vue';

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
    <RouterLink to="/findings" class="back-link"><ArrowLeft :size="14" /> Back to findings</RouterLink>
    <h1>Finding detail</h1>

    <LoadingSkeleton v-if="loading" variant="detail" />
    <ErrorState v-else-if="error" :message="error" />

    <div v-else-if="finding" class="detail-grid">
      <div class="card">
        <div class="badges-row">
          <SeverityBadge :severity="finding.severity" />
          <ActionBadge :action="finding.actionTaken" />
        </div>
        <dl>
          <dt>ID</dt>
          <dd><code>{{ finding.id }}</code></dd>
          <dt>Type</dt>
          <dd>{{ finding.type }}</dd>
          <dt>Route</dt>
          <dd><code>{{ finding.route }}</code> ({{ finding.method }})</dd>
          <dt>Rule</dt>
          <dd>{{ finding.ruleName ?? '—' }}</dd>
          <dt>Detail</dt>
          <dd>{{ finding.detail }}</dd>
          <dt>Timestamp</dt>
          <dd>{{ new Date(finding.timestamp).toLocaleString() }}</dd>
        </dl>
      </div>

      <div class="card">
        <h2>Request context</h2>
        <KeyValueTree :data="finding.requestContext as unknown as Record<string, unknown>" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  margin-bottom: var(--space-3);
}
.back-link:hover {
  color: var(--accent);
}
.detail-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.badges-row {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-3) var(--space-4);
  margin: 0;
}
dt {
  font-weight: 600;
  color: var(--text);
  font-size: 13px;
}
dd {
  margin: 0;
  color: var(--text-h);
  font-size: 14px;
}
</style>
