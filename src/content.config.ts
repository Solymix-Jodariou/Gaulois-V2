import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const guide = defineCollection({
  loader: glob({ pattern: "*.md", base: "./content/guide" }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    // Retirer `draft: true` une fois la fiche rédigée par le clan.
    draft: z.boolean().default(false),
  }),
});

export const collections = { guide };
