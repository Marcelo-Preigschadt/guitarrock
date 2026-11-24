import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = fileURLToPath(
  new URL("../public/alphatab/font", import.meta.url),
);
mkdirSync(target, { recursive: true });
cpSync(
  fileURLToPath(
    new URL("../node_modules/@coderline/alphatab/dist/font", import.meta.url),
  ),
  target,
  { recursive: true },
);
