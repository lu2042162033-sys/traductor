import path from "node:path";
import { defineConfig } from "@playwright/test";

const fakeAudioPath = path.resolve("test-results/fake-audio.wav");
const usesExternalServer =
  process.env.TRADUCTOR_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4173/traductor/",
    channel: "chrome",
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeAudioPath}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: usesExternalServer
    ? undefined
    : {
        command:
          "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/traductor/",
        reuseExistingServer: false,
        timeout: 30_000,
      },
  reporter: [["list"]],
});
