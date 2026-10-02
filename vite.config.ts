import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: { ignored: ['**/minecraft-memory-assets/**', '**/.cache/**', '**/public/generated/**'] },
  },
});
