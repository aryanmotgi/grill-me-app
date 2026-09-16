import { defineConfig } from "vitest/config";

// standalone config (not merged with vite.config.ts): the app config pulls in
// react + tailwind plugins that pure logic tests don't need
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
