import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Kept separate from vite.config.ts (used by `vite build`) so the
// `vue-tsc -b` production build never has to reconcile vitest's own
// nested vite typings against the project's top-level vite version.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
  },
});
