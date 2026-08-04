import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Only apps/web has .tsx tests today; the plugin is a no-op for every .ts file elsewhere
  // in the workspace, so it is safe to load once here rather than duplicating a per-package
  // vitest config.
  plugins: [react()],
  test: {
    include: ['packages/*/src/**/*.{test,spec}.ts', 'apps/*/src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
  },
});
