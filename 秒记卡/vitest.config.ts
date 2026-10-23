import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // jsdom 只有在有真实 origin 时才提供 localStorage（默认 about:blank 不给）
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000/',
      },
    },
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.mjs'],
  },
});
