#!/usr/bin/env node
// Inserta una línea "- YYYY-MM-DD: <asunto del commit>" al inicio de la
// sección "## Changelog" de README.md, y la deja staged para que quede
// dentro del mismo commit (invocado desde el hook prepare-commit-msg).
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function main() {
  const msgFile = process.argv[2];
  if (!msgFile || !fs.existsSync(msgFile)) return;

  const subject = fs
    .readFileSync(msgFile, "utf8")
    .split("\n")[0]
    .trim();
  if (!subject) return;

  const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
  const readmePath = path.join(repoRoot, "README.md");
  if (!fs.existsSync(readmePath)) return;

  const date = new Date().toISOString().slice(0, 10);
  const entry = `- ${date}: ${subject}`;

  const original = fs.readFileSync(readmePath, "utf8");
  const lines = original.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === "## Changelog");
  if (headingIdx === -1) return;

  // Evita duplicados si el hook se dispara más de una vez para el mismo commit.
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
}

main();
