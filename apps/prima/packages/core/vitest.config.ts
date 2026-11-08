import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
    // See test/yield.ts: lets the runner's messages through between tests on a slow CI machine.
    setupFiles: ['./test/yield.ts'],
  },
});
