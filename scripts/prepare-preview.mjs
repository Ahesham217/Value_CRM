import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

// Vite writes a deploy redirect; patch that exact output, never the source
// production configuration. Run only after a successful Vite build.
const redirectFile = path.resolve(".wrangler/deploy/config.json");
const redirect = JSON.parse(await readFile(redirectFile, "utf8"));
if (typeof redirect.configPath !== "string") {
  throw new Error("Vite did not provide a generated Wrangler configPath. Run the build first.");
}
const configFile = path.resolve(path.dirname(redirectFile), redirect.configPath);
const config = JSON.parse(await readFile(configFile, "utf8"));
if (!config.assets?.directory) {
  throw new Error("The generated configuration has no assets directory. Run the Vite build first.");
}
await access(path.resolve(path.dirname(configFile), config.assets.directory));
if (config.previews == null) config.previews = {};
if (typeof config.previews !== "object" || Array.isArray(config.previews)) {
  throw new Error("Generated previews must be a configuration object.");
}
await writeFile(configFile, JSON.stringify(config, null, 2) + "\n");
console.log("Preview configuration ready:", path.relative(process.cwd(), configFile));
console.log("previews:", JSON.stringify(config.previews));
console.log("Built assets:", config.assets.directory);
