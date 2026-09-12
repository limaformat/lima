/**
 * Bundles src/extension.ts (and the Lima parser it imports from ../../js
 * source) into dist/extension.js as a single CommonJS file for VS Code.
 *
 *   bun run esbuild.mjs [--watch] [--production]
 */

import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  // `vscode` is provided by the host at runtime and must not be bundled.
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching…");
} else {
  await build(options);
}
