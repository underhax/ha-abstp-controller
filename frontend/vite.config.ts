import 'vitest/config';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: new URL('./src/abstp-player-card.ts', import.meta.url).pathname,
      fileName: () => 'abstp-player-card.js',
      formats: ['es'],
      name: 'AbstpPlayerCard',
    },
    outDir: '../custom_components/abstp_controller/www',
    rollupOptions: {
      external: [],
    },
  },
  plugins: [
    cssInjectedByJsPlugin(),
    compression({
      algorithms: ['gzip', 'brotliCompress'],
      threshold: 1025,
    }),
  ],
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text'],
    },
    environment: 'happy-dom',
  },
});
