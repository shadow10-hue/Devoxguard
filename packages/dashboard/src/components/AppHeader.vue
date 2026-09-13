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
        <span class="brand-mark">
          <ShieldCheck :size="20" :stroke-width="2.2" class="brand-icon" />
        </span>
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
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: saturate(1.4) blur(14px);
  -webkit-backdrop-filter: saturate(1.4) blur(14px);
  border-bottom: 1px solid var(--border);
}
.app-header-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-3) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  color: inherit;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  color: #fff;
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  box-shadow: var(--shadow-accent), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
  transition: transform var(--dur) var(--ease);
}
.brand:hover .brand-mark {
  transform: translateY(-1px) rotate(-3deg);
}
.brand-icon {
  color: #fff;
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
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}
.nav-link {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  transition:
    background-color var(--dur) var(--ease),
    color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}
.nav-link:hover {
  color: var(--text-h);
}
.nav-link--active {
  color: var(--accent);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
</style>
