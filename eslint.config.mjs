import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Codebase convention: prefix an intentionally-unused binding with `_`
      // (e.g. destructured props/args not needed by a given component/route).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node/CJS tooling scripts (git hooks, postinstall setup) — not
    // app source, run directly with `node` outside the Next.js/TS toolchain.
    // Scoped narrowly so it doesn't also exempt other scripts/*.ts files.
    ".githooks/**",
    "scripts/setup-git-hooks.js",
  ]),
]);

export default eslintConfig;
