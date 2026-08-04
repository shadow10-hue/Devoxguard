<script setup lang="ts">
import { computed } from 'vue';

// This renders Finding.requestContext (params/query/body/headers/...),
// which includes the raw HTTP body of the original request — fully
// attacker-controlled. Without caps here, a maliciously deep or wide
// JSON body (still well under any request body size limit) can force
// this component to synchronously instantiate an unbounded number of
// nested Vue component instances, freezing or crashing the operator's
// browser tab when they open that finding. See KeyValueTree security
// review finding: unbounded recursion over attacker data.
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY_ITEMS = 20;
const MAX_VALUE_LENGTH = 500;

const props = withDefaults(
  defineProps<{
    data: Record<string, unknown>;
    depth?: number;
  }>(),
  { depth: 0 },
);

const entries = computed(() => Object.entries(props.data));
const visibleEntries = computed(() => entries.value.slice(0, MAX_KEYS));
const hiddenKeyCount = computed(() => Math.max(0, entries.value.length - MAX_KEYS));
const atMaxDepth = computed(() => props.depth >= MAX_DEPTH);

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}… (truncated)` : text;
}

function display(value: unknown): string {
  if (Array.isArray(value)) {
    const shown = value.slice(0, MAX_ARRAY_ITEMS).join(', ');
    const remaining = value.length - MAX_ARRAY_ITEMS;
    return truncate(shown) + (remaining > 0 ? ` … (${remaining} more)` : '');
  }
  return truncate(String(value));
}
</script>

<template>
  <dl class="kv-tree">
    <template v-for="[key, value] in visibleEntries" :key="key">
      <dt>{{ humanize(key) }}</dt>
      <dd v-if="isEmpty(value)" class="kv-empty">None</dd>
      <dd v-else-if="isPlainObject(value) && atMaxDepth" class="kv-empty">
        {{ Object.keys(value).length }} nested field(s) — max depth reached
      </dd>
      <dd v-else-if="isPlainObject(value)">
        <KeyValueTree :data="value" :depth="depth + 1" class="kv-nested" />
      </dd>
      <dd v-else>{{ display(value) }}</dd>
    </template>
    <template v-if="hiddenKeyCount > 0">
      <dt>…</dt>
      <dd class="kv-empty">{{ hiddenKeyCount }} more field(s) hidden</dd>
    </template>
  </dl>
</template>

<style scoped>
.kv-tree {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: 13px;
}
.kv-tree dt {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.kv-tree dd {
  margin: 0;
  color: var(--text-h);
  font-family: var(--mono);
  word-break: break-word;
}
.kv-empty {
  color: var(--text);
  font-family: var(--sans);
  font-style: italic;
  opacity: 0.7;
}
.kv-nested {
  padding: var(--space-2) 0 var(--space-2) var(--space-4);
  border-left: 1px solid var(--border);
}
</style>
