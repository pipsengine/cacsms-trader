import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/mt5-bridge': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mt5-bridge/, ''),
      },
      '/dev/bridge-control': {
        target: 'http://127.0.0.1:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dev\/bridge-control/, ''),
      },
    },
  },
});
