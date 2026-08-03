import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/b2b-erp': {
        target: 'https://blisscorp.niuxpro.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/b2b-erp/, '/e/action/33_json/14_vtab2bprd/receive')
      }
    }
  }
});
