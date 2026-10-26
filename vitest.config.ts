import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
