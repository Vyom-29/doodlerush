import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores(["**/node_modules/**", "**/.next*/**", "**/dist/**", "**/out/**"]),
]);
