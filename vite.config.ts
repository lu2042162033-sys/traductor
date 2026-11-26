import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: "/traductor/",
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: env.VITE_DEV_WORKER_ORIGIN || "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
