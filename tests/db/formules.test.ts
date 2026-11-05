/**
 * Le serveur et l'aperçu à l'écran doivent donner les mêmes chiffres : le serveur fait foi,
 * mais un joueur ne doit pas voir une prévision différente du résultat.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEFAULT_CONFIG, capacity, neutralCost, regenStep, resolveAttack, settle, type Terrain } from "../../src/lib/conquete/rules";
import { TestDb } from "../support/database";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

const config = JSON.stringify(DEFAULT_CONFIG);
const TERRAINS: Terrain[] = ["plains", "highland", "mountain"];

describe("le calcul SQL et le calcul de l'écran s'accordent", () => {
  it("sur la capacité", async () => {
    for (const hexes of [0, 1, 5, 20, 100, 528]) {
      for (const caps of [0, 1, 100, 1000, 10_000, 100_000, 500_000, 1_000_000]) {
        const [row] = await db.sql<{ v: number }>("select internal.capacity($1, $2, $3::jsonb) as v", [hexes, caps, config]);
        expect(row!.v).toBeCloseTo(capacity(hexes, caps), 6);
      }
    }
  });

  it("sur un pas de régénération", async () => {
    for (const [troops, cap] of [[0, 100_000], [25_000, 183_255], [100_000, 183_255], [183_255, 183_255], [250_000, 183_255], [1, 100_000]] as const) {
      const [row] = await db.sql<{ v: number }>("select internal.regen_step($1, $2, $3::jsonb) as v", [troops, cap, config]);
      expect(row!.v).toBeCloseTo(regenStep(troops, cap), 6);
    }
  });

  it("sur la réserve après un temps donné", async () => {
    const t0 = "2026-11-06T12:00:00Z";
    for (const [troops, hours, cap] of [[25_000, 24, 183_255], [25_000, 168, 183_255], [75_000, 24, 383_255], [0, 3, 100_000], [500_000, 48, 183_255], [50_000, 0.5, 183_255]] as const) {
      const now = new Date(Date.parse(t0) + hours * 3_600_000).toISOString();
      const [row] = await db.sql<{ troops: string }>("select troops from internal.settled($1, $2::timestamptz, $3::timestamptz, $4, $5::jsonb)", [troops, t0, now, cap, config]);
      expect(Number(row!.troops), `${troops} en ${hours} h`).toBe(settle(troops, hours * 3_600_000, cap).troops);
    }
  });

  it("sur le prix d'une terre libre", async () => {
    for (const terrain of TERRAINS) {
      const [row] = await db.sql<{ v: string }>("select internal.neutral_cost($1::public.terrain_type, $2::jsonb) as v", [terrain, config]);
      expect(Number(row!.v)).toBe(neutralCost(terrain));
    }
  });

  it("sur tous les combats d'une large grille", async () => {
    let checked = 0;
    for (const terrain of TERRAINS) {
      for (const garrison of [1, 2, 10, 500, 1400, 5000, 10_000, 50_000, 200_000, 2_000_000]) {
        for (const sent of [1, 5, 100, 1000, 3000, 5000, 7584, 12_000, 15_000, 20_000, 70_000, 300_000, 5_000_000]) {
          const [row] = await db.sql<{ won: boolean; ratio: number; losses: number; survivors: string; garrison_after: string }>(
            "select * from internal.resolve_attack($1, $2, $3::public.terrain_type, $4::jsonb)",
            [sent, garrison, terrain, config],
          );
          const preview = resolveAttack(sent, garrison, terrain);
          const label = `${terrain}, garnison ${garrison}, envoyés ${sent}`;
          expect(row!.won, label).toBe(preview.won);
          expect(Number(row!.survivors), label).toBe(preview.survivors);
          expect(Number(row!.garrison_after), label).toBe(preview.garrisonAfter);
          expect(row!.losses, label).toBeCloseTo(preview.losses, 6);
          checked++;
        }
      }
    }
    expect(checked).toBe(390);
  });
});
