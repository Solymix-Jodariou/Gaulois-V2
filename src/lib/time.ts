const TZ = "Europe/Paris";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export interface ParisParts {
  /** AAAA-MM-JJ à Paris. */
  date: string;
  hour: number;
  /** 0 = lundi, 6 = dimanche. */
  weekday: number;
}

export function parisParts(iso: string | Date): ParisParts {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    weekday: WEEKDAYS[p.weekday ?? ""] ?? 0,
  };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Liste des jours de `from` à `to` inclus (AAAA-MM-JJ). */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
