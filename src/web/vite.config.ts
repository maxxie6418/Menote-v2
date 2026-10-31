import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

function resolveAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function resolveBuildCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __APP_BUILD_COMMIT__: JSON.stringify(resolveBuildCommit()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
