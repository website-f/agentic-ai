import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // See test/yield.ts: lets the runner's messages through between tests on a slow CI machine.
    setupFiles: ['./test/yield.ts'],
  },
});
