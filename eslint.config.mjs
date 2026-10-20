import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly", process: "readonly", window: "readonly", document: "readonly",
        navigator: "readonly", localStorage: "readonly", FormData: "readonly", queueMicrotask: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", fetch: "readonly", URL: "readonly",
      },
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "coverage/**", "test-results/**", "playwright-report/**"]),
]);
