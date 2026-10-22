import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.VFX_CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: [
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node dist/cli.js studio --port 4178",
    url: "http://127.0.0.1:4178",
    reuseExistingServer: !process.env.CI,
  },
});
