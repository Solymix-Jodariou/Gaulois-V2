import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";

export default [
  { ignores: ["dist/", "dist-conquete/", ".astro/", "node_modules/", "public/", "test-results/", "playwright-report/"] },
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
];
