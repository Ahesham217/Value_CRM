import { pathToFileURL } from "node:url";
import { runPiPdfCleanup } from "../src/lib/pi-pdf-cleanup.ts";

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runPiPdfCleanup({
    env: process.env,
    argv: process.argv,
    stdout: (line) => console.log(line),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
