import { defineConfig } from 'vitest/config';

// Exists so vitest does not load vite.config.ts (the extension's library build
// and manifest validation).
export default defineConfig({});
