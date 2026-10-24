// Runs the code blocks of skills/paymento-accept-payments/references/nodejs.md against the harness.
// node --experimental-transform-types --no-warnings tests/check-nodejs-reference.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const reference = readFileSync(join(here, "../skills/paymento-accept-payments/references/nodejs.md"), "utf8").replace(/\r\n/g, "\n");
const snippets = [...reference.matchAll(/```ts\n([\s\S]*?)```/g)]
  .map(([, code]) => code
    .replace(/^import .*\n/gm, "")       // the harness provides crypto and the stubs
    .replace(/^app\.(post|put).*\n/gm, "") // routes need a real Express app
    .replace(/^export /gm, ""))
  .join("\n");

const harness = readFileSync(join(here, "nodejs-reference.harness.ts"), "utf8");
if (!harness.includes("/*@SNIPPETS@*/")) throw new Error("harness marker missing");
const file = join(mkdtempSync(join(tmpdir(), "paymento-ref-")), "run.ts");
writeFileSync(file, harness.replace("/*@SNIPPETS@*/", () => snippets));
execFileSync(process.execPath, ["--experimental-transform-types", "--no-warnings", file], { stdio: "inherit" });
