/**
 * Les vraies dates de la carte : ses journées, ses records et les repères de la frise.
 * Tout vient de l'historique officiel, daté par OpenFront, et se compte en jours de Paris.
 */
import { dayRange, parisParts } from "../time";

export interface DayData {
  date: string;
  frame: number;
  pixels: number;
  rank: number | null;
  taken: number;
  lost: number;
}

export interface DayRow extends DayData {
  /** Pixels gagnés moins pixels perdus ce jour-là. */
  net: number;
  /** La position du film d'où rejouer cette journée : la fin de la précédente, ou juste avant le premier pixel de GAL. */
  start: number;
  /** `false` : la journée n'était pas finie à la dernière mise à jour. */
  complete: boolean;
}

/** Le jour de Paris d'une date en secondes Unix. */
export const parisDayOf = (seconds: number) => parisParts(new Date(seconds * 1000)).date;

/**
 * Prépare les journées pour l'affichage, de la plus ancienne à la plus récente.
 * La journée de la dernière mise à jour n'est pas finie : ses chiffres peuvent encore changer.
 */
export function dayRows(days: readonly DayData[], frames: readonly { gal: number }[], fetchedAt: string): DayRow[] {
  const today = parisParts(fetchedAt).date;
  const firstFrame = frames.findIndex((f) => f.gal > 0);
  return days.map((day, i) => ({
    ...day,
    net: day.taken - day.lost,
    start: days[i - 1]?.frame ?? Math.max(0, firstFrame),
    complete: day.date < today,
  }));
}

/**
 * Le territoire à la fin de chaque journée terminée, pour le graphique.
 * Un jour sans aucun événement sur la carte reste un trou : le temps ne se resserre pas.
 */
export function territorySeries(rows: readonly DayRow[]): { date: string; value: number | null }[] {
  const finished = rows.filter((r) => r.complete);
  const first = finished[0];
  const last = finished.at(-1);
  if (!first || !last) return [];
  const pixels = new Map(finished.map((r) => [r.date, r.pixels]));
  return dayRange(first.date, last.date).map((date) => ({ date, value: pixels.get(date) ?? null }));
}

/** L'évolution du territoire depuis la fin de la dernière journée terminée. `null` : aucune journée terminée. */
export function changeSinceLastDay(rows: readonly DayRow[], pixels: number): { date: string; change: number } | null {
  const last = rows.filter((r) => r.complete).at(-1);
  return last ? { date: last.date, change: pixels - last.pixels } : null;
}

export interface DayHighlights {
  /** La journée terminée au plus fort gain. `null` : aucune journée terminée n'a été positive. */
  gain: DayRow | null;
  /** La journée terminée au plus fort recul. `null` : aucune journée terminée n'a été négative. */
  loss: DayRow | null;
}

/** Les records se limitent aux journées terminées : celle en cours pourrait encore les démentir. À égalité, la première garde le record. */
export function dayHighlights(rows: readonly DayRow[]): DayHighlights {
  let gain: DayRow | null = null;
  let loss: DayRow | null = null;
  for (const row of rows) {
    if (!row.complete) continue;
    if (row.net > (gain?.net ?? 0)) gain = row;
    if (row.net < (loss?.net ?? 0)) loss = row;
  }
  return { gain, loss };
}

export interface DayMark {
  /** Où ce jour commence sur la frise : le nombre d'images jouées juste avant lui. */
  frame: number;
  date: string;
}

/** Où commence chaque jour sur la frise. Une image ne chevauche jamais deux jours. Un film sans dates n'a aucun repère. */
export function filmDayMarks(frames: readonly { at?: number | undefined }[]): DayMark[] {
  const marks: DayMark[] = [];
  frames.forEach((frame, i) => {
    if (frame.at === undefined) return;
    const date = parisDayOf(frame.at);
    if (marks.at(-1)?.date !== date) marks.push({ frame: i, date });
  });
  return marks;
}

/**
 * Place les dates écrites sous la frise, sans chevauchement ni débordement.
 * Le film suit les événements, pas le temps : les jours n'y ont pas la même largeur.
 * Le dernier jour est toujours écrit, puis autant de jours que la place en laisse, en partant du premier.
 */
export function placeDayLabels<T extends { frame: number }>(marks: readonly T[], frames: number, width: number, labelWidth: number): { mark: T; left: number }[] {
  if (frames <= 0 || width < labelWidth) return [];
  const leftOf = (mark: T) => Math.min(Math.max((mark.frame / frames) * width - labelWidth / 2, 0), width - labelWidth);
  const last = marks.at(-1);
  const placed: { mark: T; left: number }[] = [];
  let edge = -Infinity;
  for (const mark of marks) {
    const left = leftOf(mark);
    if (mark !== last && (left < edge || (last !== undefined && left + labelWidth > leftOf(last)))) continue;
    placed.push({ mark, left });
    edge = left + labelWidth;
  }
  return placed;
}

export interface TerritoryReading {
  date: string;
  pixels: number;
  rank: number | null;
}

/**
 * Les relevés du territoire pour la gazette, par date croissante. Le territoire à la fin d'une journée
 * terminée vient de l'historique, plus exact et plus ancien que le relevé quotidien de la collecte,
 * qui reste la seule source sans film daté et pour le jour même.
 */
export function territoryReadings(rows: readonly DayRow[], journal: readonly TerritoryReading[]): TerritoryReading[] {
  const complete = rows.filter((r) => r.complete);
  const known = new Set(complete.map((r) => r.date));
  return [...complete, ...journal.filter((j) => !known.has(j.date))].sort((a, b) => a.date.localeCompare(b.date));
}
