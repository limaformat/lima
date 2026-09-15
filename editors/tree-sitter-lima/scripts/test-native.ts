import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cache = join(root, ".cache");
const library = join(cache, "lima.so");
const cli = join(root, "node_modules", ".bin", "tree-sitter");
const env = { ...process.env, XDG_CACHE_HOME: cache, NO_COLOR: "1" };

mkdirSync(cache, { recursive: true });
for (const args of [
  [cli, "build", "-o", library],
  [cli, "test", "--lib-path", library, "--lang-name", "lima"],
]) {
  const result = Bun.spawnSync(args, { cwd: root, env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
