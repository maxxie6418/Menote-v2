import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const destination = resolve(process.argv[2] ?? ".");
mkdirSync(destination, { recursive: true });
const source = mkdtempSync(join(tmpdir(), "menote-mobile-contract-"));
try {
  for (const file of ["auth.ts", "mobile.ts"]) {
    copyFileSync(new URL(`src/contracts/${file}`, import.meta.url), join(source, file));
  }
  writeFileSync(join(source, "package.json"), JSON.stringify({
    name: "@menote/mobile-contract",
    version: "1.0.0",
    type: "module",
    main: "./mobile.ts",
    types: "./mobile.ts",
    files: ["auth.ts", "mobile.ts"],
  }));
  const args = ["pack", "--ignore-scripts", "--pack-destination", destination];
  const windows = process.platform === "win32";
  if (windows) args.unshift(join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"));
  const result = spawnSync(windows ? process.execPath : "npm", args, {
    cwd: source, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Could not pack the mobile contract");
} finally {
  rmSync(source, { recursive: true, force: true });
}
