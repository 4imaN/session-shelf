import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/ui' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4317',
      '/terminal': { target: 'ws://127.0.0.1:4317', ws: true },
    },
  },
});
