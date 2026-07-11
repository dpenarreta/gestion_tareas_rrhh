#!/usr/bin/env node
// Inserta una línea "- YYYY-MM-DD: <asunto del commit>" al inicio de la
// sección "## Changelog" de README.md y la incluye en el commit recién
// creado vía `git commit --amend --no-edit`.
//
// Se invoca desde el hook post-commit (no prepare-commit-msg): un `git add`
// hecho en prepare-commit-msg NO queda incluido en el commit que se está
// creando (comprobado empíricamente), mientras que enmendar el commit desde
// post-commit sí funciona. El amend vuelve a disparar post-commit, así que
// esta función debe ser idempotente — si la entrada ya está presente, no
// hace nada — para no entrar en loop.
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Tipos de commit (convención "type(scope): subject" o "type: subject") que
// no se registran en el Changelog por ser ruido de mantenimiento, no cambios
// de producto.
const SKIPPED_TYPES = ["chore", "docs"];
const SKIP_PATTERN = new RegExp(`^(${SKIPPED_TYPES.join("|")})(\\(.+\\))?:`, "i");

function main() {
  const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();

  // No tocar commits en medio de un rebase/cherry-pick — evita interferir
  // con el estado interno de git en esos flujos.
  if (
    fs.existsSync(path.join(repoRoot, ".git", "rebase-merge")) ||
    fs.existsSync(path.join(repoRoot, ".git", "rebase-apply")) ||
    fs.existsSync(path.join(repoRoot, ".git", "CHERRY_PICK_HEAD"))
  ) {
    return;
  }

  const subject = execSync("git log -1 --format=%s").toString().trim();
  if (!subject || subject.startsWith("Merge ") || SKIP_PATTERN.test(subject)) return;

  const readmePath = path.join(repoRoot, "README.md");
  if (!fs.existsSync(readmePath)) return;

  const date = new Date().toISOString().slice(0, 10);
  const entry = `- ${date}: ${subject}`;

  const original = fs.readFileSync(readmePath, "utf8");
  const lines = original.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === "## Changelog");
  if (headingIdx === -1) return;

  // Idempotencia: si esta entrada ya está en las primeras líneas de la
  // sección, no hay nada que hacer (rompe la recursión del amend).
  const nextFewLines = lines.slice(headingIdx + 1, headingIdx + 6);
  if (nextFewLines.some((l) => l.trim() === entry.trim())) return;

  // Inserta justo antes de la primera línea "- " existente (o antes de la
  // siguiente sección "## " si el changelog está vacío).
  let insertAt = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("- ") || lines[i].startsWith("## ")) {
      insertAt = i;
      break;
    }
  }

  lines.splice(insertAt, 0, entry);
  fs.writeFileSync(readmePath, lines.join("\n"));

  execSync(`git add "${readmePath}"`, { cwd: repoRoot });
  execSync("git commit --amend --no-edit -q", {
    cwd: repoRoot,
    env: { ...process.env, GIT_EDITOR: "true" },
  });
}

main();
