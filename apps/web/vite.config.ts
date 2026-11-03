import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(appDirectory, "../..");

export default defineConfig(({ mode }) => {
  // Vite executa a partir de apps/web; apontar loadEnv à raiz mantém o proxy alinhado ao .env usado por API e worker.
  const env = loadEnv(mode, repositoryRoot, "");
  const apiTarget = process.env.API_PROXY_TARGET ?? env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";
  const webPort = Number(env.WEB_PORT ?? "5173");
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) throw new Error("WEB_PORT_INVALID");
  return {
    plugins: [react()],
    server: {
      port: webPort,
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
    preview: {
      port: webPort,
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
    test: {
      environment: "jsdom",
      exclude: ["e2e/**", "node_modules/**"],
      setupFiles: "./src/test-setup.ts",
    },
  };
});