import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.{test,spec}.ts', 'apps/*/src/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
});
