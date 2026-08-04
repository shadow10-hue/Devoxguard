<script setup lang="ts">
import AppHeader from './components/AppHeader.vue';
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-main {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
}
</style>
