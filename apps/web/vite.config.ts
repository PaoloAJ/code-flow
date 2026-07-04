import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5573,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4400',
        changeOrigin: true,
      },
    },
  },
});
