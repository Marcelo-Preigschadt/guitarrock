// Keep existing Codespaces in sync with newly added runtime dependencies.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const digest = createHash("sha256")
  .update(readFileSync(root + "package.json"))
  .update(readFileSync(root + "package-lock.json"))
  .digest("hex");
const marker = root + "node_modules/.riffsync-dependencies";
let current = "";
try {
  current = readFileSync(marker, "utf8");
} catch {
  /* First install or previous app version. */
}
if (
  current !== digest ||
  !existsSync(
    root + "node_modules/neural-amp-modeler-wasm/dist/engine/index.js",
  )
) {
  console.log("Atualizando dependências da interface RiffSync…");
  const result = spawnSync(
    "npm",
    ["ci", "--prefix", root, "--no-audit", "--no-fund"],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(
      "A atualização da interface falhou. O servidor pode continuar exibindo a versão anterior; confira o erro npm acima antes de reiniciar.",
    );
    process.exit(result.status || 1);
  }
  writeFileSync(marker, digest);
}
