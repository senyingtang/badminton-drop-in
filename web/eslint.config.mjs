import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // This project intentionally uses effects to kick off async loads (void load()).
      // The React Compiler lint rules are currently too strict for our patterns.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",

      // This codebase contains many incremental migrations; allow `any` in UI glue / API routes.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
