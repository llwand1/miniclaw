import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../dist/web',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        floating: resolve(__dirname, 'floating.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:18791',
    },
  },
});
