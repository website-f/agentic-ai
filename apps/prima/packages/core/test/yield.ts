import { beforeEach } from 'vitest';

// The in-memory store answers with promises only, so a long test file never gives the event loop a turn. On a slow
// CI machine core.test.ts runs past vitest's 60 s message timeout and fails with "Timeout calling onTaskUpdate"
// although every test passed (reproduced on main 15bbc5e with one CPU core). A macrotask between tests lets the
// runner's replies arrive.
beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
