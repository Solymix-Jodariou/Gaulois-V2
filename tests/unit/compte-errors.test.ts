import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, errorMessage } from "../../src/lib/compte/errors";

// Les migrations des comptes, des rôles et de la Direction : les seules fonctions que le site appelle encore.
const SQL = ["20261105000100_comptes_et_roles", "20261105000200_validation_des_membres", "20261105000900_direction", "20261106000100_roles_prevus"]
  .map((name) => readFileSync(`supabase/migrations/${name}.sql`, "utf8"))
  .join("\n");

describe("les refus du serveur", () => {
  it("ont tous un message en français", () => {
    const codes = new Set([...SQL.matchAll(/internal\.(?:fail|error_json)\('([a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(20);
    expect([...codes].filter((code) => !(code in ERROR_MESSAGES))).toEqual([]);
  });

  it("restent lisibles pour un code inconnu", () => {
    expect(errorMessage("code_inconnu")).toBe("Une erreur inattendue est survenue.");
  });
});
