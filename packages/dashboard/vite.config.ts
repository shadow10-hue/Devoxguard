import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third arg '' (no prefix filter) loads DEV_API_KEY from .env.local too —
  // by default Vite only auto-loads VITE_-prefixed vars, and only into the
  // client bundle. This value must reach the config file (Node), not the
  // bundle, so it's read explicitly here instead.
  const fileEnv = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],
    server: {
      // Mirrors nginx's production reverse proxy (AR-6): the dev server
      // injects the API key here, in Node — never bundled to the browser.
      // No VITE_ prefix on purpose: that prefix means "inline into the
      // client bundle", the opposite of what this value needs.
      proxy: {
        '/devoxguard/api': {
          target: 'http://localhost:3000',
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-devoxguard-api-key', fileEnv.DEV_API_KEY ?? 'dev-api-key')
            })
          },
        },
      },
    },
  }
})
