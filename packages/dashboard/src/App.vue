<script setup lang="ts"></script>

<template>
  <div class="app">
    <nav>
      <RouterLink to="/">Overview</RouterLink>
      <RouterLink to="/findings">Findings</RouterLink>
      <RouterLink to="/rules">Rules</RouterLink>
    </nav>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 960px;
  margin: 0 auto;
  padding: 1rem;
}
nav {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #3333;
}
nav a {
  text-decoration: none;
  font-weight: 600;
}
nav a.router-link-exact-active {
  text-decoration: underline;
}
</style>
