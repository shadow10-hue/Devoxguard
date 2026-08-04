<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ShieldCheck } from '@lucide/vue';
import type { NavKey } from '../router';

const route = useRoute();
const activeKey = computed(() => route.meta.navKey);

const links: { key: NavKey; to: string; label: string }[] = [
  { key: 'overview', to: '/', label: 'Overview' },
  { key: 'findings', to: '/findings', label: 'Findings' },
  { key: 'rules', to: '/rules', label: 'Rules' },
];
</script>

<template>
  <header class="app-header">
    <div class="app-header-inner">
      <RouterLink to="/" class="brand">
        <ShieldCheck :size="24" :stroke-width="2" class="brand-icon" />
        <span class="brand-text">
          <span class="brand-name">DevoxGuard</span>
          <span class="brand-tagline">Security Engine</span>
        </span>
      </RouterLink>

      <nav class="nav" aria-label="Primary">
        <RouterLink
          v-for="link in links"
          :key="link.key"
          :to="link.to"
          class="nav-link"
          :class="{ 'nav-link--active': activeKey === link.key }"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.app-header-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  color: inherit;
}
.brand-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand-name {
  font-weight: 700;
  font-size: 16px;
  color: var(--text-h);
}
.brand-tagline {
  font-size: 11px;
  color: var(--text);
  opacity: 0.75;
}
@media (max-width: 640px) {
  .brand-tagline {
    display: none;
  }
}
.nav {
  display: flex;
  gap: var(--space-2);
}
.nav-link {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.nav-link:hover {
  background: var(--surface-hover);
  color: var(--text-h);
}
.nav-link--active {
  color: var(--accent);
  background: var(--accent-bg);
}
</style>
