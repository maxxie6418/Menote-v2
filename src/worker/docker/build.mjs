import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));

export const dockerBundleOptions = {
  absWorkingDir: directory,
  entryPoints: ["server.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: 'import { createRequire as createMenoteRequire } from "node:module"; const require = createMenoteRequire(import.meta.url);' },
  loader: { ".sql": "text" },
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await build({ ...dockerBundleOptions, outfile: "../dist/docker/server.mjs" });
}
