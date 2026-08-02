import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Environment lives at the repository root, not in this workspace: the command line tools
// read the same file, and two copies would drift the moment one is edited.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react()],
  envDir: repositoryRoot,
  server: { port: 5173 },
});
