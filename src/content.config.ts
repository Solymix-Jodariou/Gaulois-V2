import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Les fiches de la section « Guide par mode ».
const guide = defineCollection({
  loader: glob({ pattern: "*.md", base: "./content/guide" }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    // Retirer `draft: true` une fois la fiche rédigée par le clan.
    draft: z.boolean().default(false),
    // La fiche occupe toute la largeur de la grille.
    wide: z.boolean().default(false),
  }),
});

// Les chapitres de la section « Le guide du clan ».
const guideClan = defineCollection({
  loader: glob({ pattern: "*.md", base: "./content/guide-clan" }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    // Affiche le graphique calculé de la croissance en tête du chapitre.
    growthChart: z.boolean().default(false),
    // Le chapitre occupe toute la largeur de la grille.
    wide: z.boolean().default(false),
  }),
});

export const collections = { guide, guideClan };
