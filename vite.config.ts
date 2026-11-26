import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api/onyx-rpc': {
        target: 'http://127.0.0.1:4173',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2021',
    rollupOptions: {
      output: {
        manualChunks: {
          'motion-vendor': ['framer-motion'],
          'ui-vendor': [
            'react',
            'react-dom',
            '@radix-ui/react-dialog',
            '@radix-ui/react-switch',
            '@radix-ui/react-tooltip',
            'lucide-react',
          ],
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
});
