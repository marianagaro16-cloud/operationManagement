import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The domain layer must be timezone-correct regardless of where it runs.
    // Deliberately run the suite in a non-Zurich zone so any accidental use of
    // the ambient timezone surfaces as a failure.
    env: { TZ: 'America/New_York' },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
