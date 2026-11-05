import type { ConquestConfig } from "./rules";

/** Le nom de chaque réglage dans l'administration. Un test vérifie qu'aucun n'est oublié. */
export const CONFIG_LABELS: Record<string, { label: string; hint: string }> = {
  tilesPerTerritory: { label: "Tuiles par territoire", hint: "Fait le lien avec les formules d'OpenFront, qui comptent en tuiles." },
  "capacity.multiplier": { label: "Capacité : multiplicateur", hint: "Le « 2 » de maxTroops." },
  "capacity.tilesExponent": { label: "Capacité : exposant des tuiles", hint: "0,6 dans OpenFront." },
  "capacity.tilesFactor": { label: "Capacité : facteur des tuiles", hint: "1 000 dans OpenFront." },
  "capacity.base": { label: "Capacité : base", hint: "50 000 dans OpenFront." },
  "capacity.capsuleFactor": { label: "Capsules : facteur", hint: "Troupes de capacité par racine de capsule. À calibrer sur les vrais dons." },
  "capacity.capsuleExponent": { label: "Capsules : exposant", hint: "0,5 pour une racine carrée. Plus bas, les gros dons pèsent moins." },
  "regen.base": { label: "Régénération : base", hint: "10 dans OpenFront." },
  "regen.exponent": { label: "Régénération : exposant", hint: "0,73 dans OpenFront." },
  "regen.divisor": { label: "Régénération : diviseur", hint: "4 dans OpenFront." },
  "regen.tickMinutes": { label: "Régénération : minutes entre deux pas", hint: "100 ms dans OpenFront, 60 minutes ici." },
  startShare: { label: "Troupes de départ", hint: "Part de la capacité sans territoire. 0,25 donne les 25 000 d'OpenFront." },
  troopsPerCapsule: { label: "Troupes par capsule donnée", hint: "100 : la règle réelle de la carte du clan. Le don arrive en renfort, dans la limite de la capacité." },
  "terrain.plains": { label: "Plaine : force du terrain", hint: "80 dans OpenFront." },
  "terrain.highland": { label: "Colline : force du terrain", hint: "100 dans OpenFront." },
  "terrain.mountain": { label: "Montagne : force du terrain", hint: "120 dans OpenFront." },
  neutralDivisor: { label: "Terre libre : diviseur", hint: "Prix par tuile = force du terrain ÷ ce nombre. 5 dans OpenFront." },
  "combat.ratioMin": { label: "Combat : rapport minimal", hint: "0,6 dans OpenFront." },
  "combat.ratioMax": { label: "Combat : rapport maximal", hint: "2 dans OpenFront." },
  "combat.lossBase": { label: "Combat : perte de base", hint: "0,463 dans OpenFront." },
  "combat.lossDensity": { label: "Combat : perte par densité", hint: "0,0039 dans OpenFront." },
  "combat.garrisonBonus": { label: "Combat : bonus de garnison", hint: "5 : celui du poste de défense d'OpenFront." },
  "limits.expansionsPerDay": { label: "Conquêtes de terre libre par jour", hint: "" },
  "limits.attacksPerDay": { label: "Attaques par jour", hint: "" },
  "limits.attackCooldownMinutes": { label: "Minutes entre deux attaques", hint: "" },
  "limits.protectionHours": { label: "Heures de protection après une prise", hint: "" },
  "limits.lastTerritoryProtected": { label: "Le dernier territoire est inattaquable", hint: "" },
  "limits.actionsPerMinute": { label: "Actions par minute et par joueur", hint: "" },
};

export type ConfigValue = number | boolean;

/** Tous les réglages, à plat : « capacity.base », « limits.attacksPerDay »… */
export function flattenConfig(config: ConquestConfig): [string, ConfigValue][] {
  const out: [string, ConfigValue][] = [];
  const walk = (node: object, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "object" && value !== null) walk(value, path);
      else out.push([path, value as ConfigValue]);
    }
  };
  walk(config, "");
  return out;
}

export function withValue(config: ConquestConfig, path: string, value: ConfigValue): ConquestConfig {
  const copy = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const keys = path.split(".");
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[keys.at(-1)!] = value;
  return copy as unknown as ConquestConfig;
}
