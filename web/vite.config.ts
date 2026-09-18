import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
