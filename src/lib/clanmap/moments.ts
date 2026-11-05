/**
 * Les grands moments du film, déduits uniquement des chiffres de chaque image.
 * Aucun texte n'est écrit à la main : si l'histoire change, les moments changent.
 */
export interface MomentFrame {
  ev: number;
  gal: number;
  rank: number | null;
}

export type MomentKind = "first" | "rank" | "fall" | "comeback" | "threshold" | "push" | "loss" | "now";

export interface Moment {
  /** Numéro de l'image, à partir de 1. */
  frame: number;
  event: number;
  kind: MomentKind;
  title: string;
}

const THRESHOLDS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000, 500_000, 1_000_000];
/** Du plus important au moins important : c'est lui qui reste si deux moments sont trop proches. */
const PRIORITY: MomentKind[] = ["now", "first", "rank", "comeback", "fall", "push", "loss", "threshold"];
const fmt = new Intl.NumberFormat("fr-FR");
const place = (rank: number) => `${rank}${rank === 1 ? "re" : "e"} place`;

export function findMoments(frames: readonly MomentFrame[], tag = "GAL"): Moment[] {
  const candidates: Omit<Moment, "event">[] = [];
  const firstIndex = frames.findIndex((f) => f.gal > 0);
  if (firstIndex < 0) return [];
  candidates.push({ frame: firstIndex + 1, kind: "first", title: `Premier pixel de ${tag}` });

  let bestRank = Infinity;
  let bestRankFrame = -1;
  frames.forEach((f, i) => {
    if (f.rank !== null && f.rank < bestRank) {
      bestRank = f.rank;
      bestRankFrame = i;
    }
  });
  if (bestRankFrame > firstIndex) candidates.push({ frame: bestRankFrame + 1, kind: "rank", title: `${tag} atteint la ${place(bestRank)}` });

  // Le creux après le sommet, puis la meilleure remontée qui suit.
  let lowRank = bestRank;
  let lowFrame = -1;
  for (let i = bestRankFrame + 1; i < frames.length; i++) {
    const rank = frames[i]?.rank ?? null;
    if (rank !== null && rank > lowRank) {
      lowRank = rank;
      lowFrame = i;
    }
  }
  if (lowFrame > 0) {
    candidates.push({ frame: lowFrame + 1, kind: "fall", title: `${tag} recule à la ${place(lowRank)}` });
    let backRank = lowRank;
    let backFrame = -1;
    for (let i = lowFrame + 1; i < frames.length; i++) {
      const rank = frames[i]?.rank ?? null;
      if (rank !== null && rank < backRank) {
        backRank = rank;
        backFrame = i;
      }
    }
    if (backFrame > 0) candidates.push({ frame: backFrame + 1, kind: "comeback", title: `${tag} remonte à la ${place(backRank)}` });
  }

  for (const threshold of THRESHOLDS) {
    const i = frames.findIndex((f) => f.gal >= threshold);
    if (i >= 0) candidates.push({ frame: i + 1, kind: "threshold", title: `${tag} franchit ${fmt.format(threshold)} pixels` });
  }

  let push = 0;
  let pushFrame = -1;
  let loss = 0;
  let lossFrame = -1;
  for (let i = firstIndex + 1; i < frames.length; i++) {
    const change = frames[i]!.gal - frames[i - 1]!.gal;
    if (change > push) {
      push = change;
      pushFrame = i;
    }
    if (change < loss) {
      loss = change;
      lossFrame = i;
    }
  }
  if (pushFrame > 0) candidates.push({ frame: pushFrame + 1, kind: "push", title: `La plus grande poussée : +${fmt.format(push)} pixels` });
  if (lossFrame > 0) candidates.push({ frame: lossFrame + 1, kind: "loss", title: `Le plus dur recul : −${fmt.format(-loss)} pixels` });

  const last = frames[frames.length - 1]!;
  if (last.gal > 0) {
    const rank = last.rank === null ? "" : `, ${place(last.rank)}`;
    candidates.push({ frame: frames.length, kind: "now", title: `Aujourd'hui : ${fmt.format(last.gal)} pixels${rank}` });
  }

  const minGap = Math.max(3, Math.floor(frames.length * 0.015));
  const kept: Omit<Moment, "event">[] = [];
  for (const kind of PRIORITY) {
    for (const candidate of candidates.filter((c) => c.kind === kind)) {
      if (kept.every((k) => Math.abs(k.frame - candidate.frame) >= minGap)) kept.push(candidate);
    }
  }
  return kept
    .sort((a, b) => a.frame - b.frame)
    .map((m) => ({ ...m, event: frames[m.frame - 1]?.ev ?? 0 }));
}
