import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

// SITE_URL : URL publique complète. BASE_PATH : préfixe pour GitHub Pages
// (par exemple /mon-depot). Voir .env.example.
export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || "http://localhost:4321",
  base: process.env.BASE_PATH || "/",
  trailingSlash: "ignore",
  integrations: [preact()],
  // Les guides n'affichent que des formules : ni coloration, ni défilement dans les blocs de code.
  markdown: { syntaxHighlight: false },
  vite: { plugins: [tailwindcss()] },
});
