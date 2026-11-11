import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.emulator.test.ts'],
    // All emulator tests share one Firestore database (and the rules tests clear it
    // before each case), so the files must not run at the same time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
