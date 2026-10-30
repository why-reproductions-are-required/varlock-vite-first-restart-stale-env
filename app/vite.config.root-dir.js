import { varlockVitePlugin } from '@varlock/vite-integration';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [varlockVitePlugin({ rootDir: import.meta.dirname })],
});
