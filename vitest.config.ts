import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@ratatube/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@ratatube/subtitle-engine': path.resolve(__dirname, 'packages/subtitle-engine/src'),
      '@ratatube/addon-sdk': path.resolve(__dirname, 'packages/addon-sdk/src'),
      '@ratatube/database': path.resolve(__dirname, 'packages/database/src')
    }
  }
});

