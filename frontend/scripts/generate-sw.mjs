import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { offlineWorkerSource } from "./offline-worker.mjs";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const walk = (dir) =>
  readdirSync(root + dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
  );
const files = walk("").filter((f) => f !== "sw.js" && !f.endsWith(".map"));
const hash = createHash("sha256");
for (const file of files) hash.update(readFileSync(root + file));
const name = `riffsync-${hash.digest("hex").slice(0, 12)}`;
writeFileSync(
  root + "sw.js",
  offlineWorkerSource(name, files),
);
