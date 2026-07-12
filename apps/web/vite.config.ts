import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: app edits don't bust the React Flow cache.
        manualChunks: {
          react: ['react', 'react-dom'],
          flow: ['@xyflow/react'],
        },
      },
    },
  },
  server: {
    port: 5573,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4400',
        changeOrigin: true,
        ws: true, // /api/collab live-session socket
      },
    },
  },
});
