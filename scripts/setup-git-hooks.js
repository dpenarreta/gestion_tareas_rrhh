#!/usr/bin/env node
// Configura core.hooksPath para activar los hooks versionados en .githooks/
// (changelog automático del README) en cualquier clon nuevo tras `npm install`.
// No-op silencioso si no hay un repo git disponible (p. ej. build en Vercel).
"use strict";

const { execSync } = require("child_process");

try {
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
} catch {
  // No es un repo git o git no está disponible: no hacer nada.
}
