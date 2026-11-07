const TZ = "Europe/Paris";
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const clock = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const dayShort = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });

export const NO_DATA = "—";

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? NO_DATA : int.format(n));
export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? NO_DATA : dec2.format(n));
export const fmtPct = (n: number | null | undefined) =>
  n === null || n === undefined ? NO_DATA : `${dec1.format(n)} %`;
export const fmtDec1 = (n: number) => dec1.format(n);
/** Un nombre et son nom, accordé : 1 partie, 2 parties. */
export const fmtCount = (n: number, word: string) => `${int.format(n)} ${word}${n > 1 ? "s" : ""}`;
export const fmtMinutes = (seconds: number) => `${int.format(Math.round(seconds / 60))} min`;
export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtClock = (iso: string) => clock.format(new Date(iso));
export const fmtDate = (iso: string) => dateOnly.format(new Date(iso));
/** Une liste croissante en suites : 2, 3, 4 et 7 donnent « 2 à 4, 7 ». */
export function fmtRanges(numbers: number[]): string {
  const ranges: [number, number][] = [];
  for (const n of numbers) {
    const last = ranges.at(-1);
    if (last && last[1] === n - 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges.map(([from, to]) => (from === to ? int.format(from) : `${int.format(from)} à ${int.format(to)}`)).join(", ");
}
/** `day` au format AAAA-MM-JJ, sans conversion de fuseau. */
export const fmtDay = (day: string) => dayShort.format(new Date(`${day}T00:00:00.000Z`));
