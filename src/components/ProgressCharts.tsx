import { useMemo, useState } from "preact/hooks";
import AnimatedNumber from "./AnimatedNumber";
import { fmtDay, fmtInt, fmtPct, fmtScore } from "../lib/format";
import type { HistorySnapshot } from "../lib/schemas";
import { bucketize, filterRange, type Bucket, type DayStat, type RangeKey } from "../lib/sessions";
import { addDays } from "../lib/time";
import { winRate } from "../lib/stats";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 jours" },
  { key: "30", label: "30 jours" },
  { key: "all", label: "Tout" },
];

function niceMax(v: number): number {
  if (v <= 5) return Math.max(v, 1);
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return v;
}

const bucketLabel = (b: Bucket) => (b.date === b.endDate ? fmtDay(b.date) : `${fmtDay(b.date)} au ${fmtDay(b.endDate)}`);

function GamesChart({ buckets, weekly }: { buckets: Bucket[]; weekly: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...buckets.map((b) => b.games)));
  const shown = hover === null ? null : buckets[hover];
  const labelIdx = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);

  return (
    <figure class="m-0">
      <figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span class="font-semibold">Parties {weekly ? "par semaine" : "par jour"}</span>
        <span class="flex items-center gap-1.5 text-muted"><i class="inline-block size-3 rounded-sm bg-win" aria-hidden="true" />Victoires</span>
        <span class="flex items-center gap-1.5 text-muted"><i class="inline-block size-3 rounded-sm bg-loss" aria-hidden="true" />Défaites</span>
      </figcaption>
      <p class="tnum mt-2 min-h-5 text-sm text-muted" aria-hidden="true">
        {shown
          ? `${bucketLabel(shown)} : ${fmtInt(shown.games)} parties, ${fmtInt(shown.wins)} victoires, ${fmtInt(shown.losses)} défaites, ${fmtPct(shown.winRate)}${shown.partial ? " (en cours)" : ""}`
          : "Survolez une barre pour le détail."}
      </p>
      <div class="relative mt-2 h-64 pl-10" aria-hidden="true" onPointerLeave={() => setHover(null)}>
        {[1, 0.5, 0].map((f) => (
          <div key={f} class="absolute inset-x-0 border-t border-line/60" style={{ top: `${(1 - f) * 100}%` }}>
            <span class="tnum absolute -top-2.5 left-0 bg-surface pr-1 text-xs text-muted">{fmtInt(Math.round(max * f))}</span>
          </div>
        ))}
        <div class="absolute inset-y-0 left-10 right-0" data-ripple-group>
          <div class="chart-sweep" />
          {hover !== null && shown && (
            <>
              <div class="chart-cursor" style={{ left: `${(hover / buckets.length) * 100}%`, width: `${100 / buckets.length}%` }} />
              <div class="chart-guide" style={{ bottom: `${(shown.games / max) * 100}%` }} />
              <div
                class="chart-label tnum"
                data-testid="chart-label"
                style={{ left: `${((hover + 0.5) / buckets.length) * 100}%`, bottom: `${(shown.games / max) * 100}%` }}
              >
                {fmtInt(shown.games)}
              </div>
            </>
          )}
          <div class="absolute inset-0 flex items-end">
            {buckets.map((b, i) => (
              <div
                key={b.date}
                class="flex h-full flex-1 flex-col justify-end px-px"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              >
                <div
                  class="fx-grow flex flex-col gap-0.5"
                  data-ripple="glow"
                  style={{
                    height: `${(b.games / max) * 100}%`,
                    opacity: b.partial ? 0.55 : 1,
                    "--i": i,
                    // Les barres voisines s'éclairent : leur hauteur, elle, ne change jamais.
                    filter: hover === null ? undefined : `brightness(${1 + 0.35 * Math.max(0, 1 - Math.abs(i - hover) / 3)})`,
                  }}
                >
                  {b.losses > 0 && <div class="min-h-px rounded-t bg-loss" style={{ flexGrow: b.losses, flexBasis: 0 }} />}
                  {b.wins > 0 && (
                    <div class={`min-h-px bg-win ${b.losses === 0 ? "rounded-t" : ""}`} style={{ flexGrow: b.wins, flexBasis: 0 }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div class="relative mt-1 h-5 pl-10 text-xs text-muted" aria-hidden="true">
        <div class="flex">
          {buckets.map((b, i) => (
            <div key={b.date} class="relative flex-1">
              {labelIdx.has(i) && (
                <span
                  class={`tnum absolute top-0 whitespace-nowrap ${i === 0 ? "left-0" : i === buckets.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"}`}
                >
                  {fmtDay(b.date)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {buckets.some((b) => b.partial) && <p class="mt-2 text-xs text-muted">Barre plus pâle : période encore en cours.</p>}
    </figure>
  );
}

interface LinePoint {
  date: string;
  value: number | null;
}

function LineChart({ title, points, invert, format }: { title: string; points: LinePoint[]; invert?: boolean; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const measured = values.length;

  if (measured === 0) {
    return (
      <div class="card p-5">
        <h3 class="text-lg">{title}</h3>
        <p class="mt-2 text-sm text-muted">Pas de données sur cette période.</p>
      </div>
    );
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const y = (v: number) => {
    const t = (v - lo) / span;
    return (invert ? t : 1 - t) * 86 + 7;
  };
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 96 + 2);
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current);
      current = "";
    } else {
      current += `${current ? "L" : "M"}${x(i)} ${y(p.value)}`;
    }
  });
  if (current) segments.push(current);
  const shown = hover === null ? null : points[hover];
  const last = [...points].reverse().find((p) => p.value !== null);

  return (
    <div class="card p-5">
      <h3 class="text-lg">{title}</h3>
      <p class="tnum mt-1 text-sm text-muted" aria-hidden="true">
        {shown
          ? `${fmtDay(shown.date)} : ${shown.value === null ? "hors classement" : format(shown.value)}`
          : last && `Dernière mesure, ${fmtDay(last.date)} : ${format(last.value as number)}`}
      </p>
      {measured < 2 ? (
        <p class="mt-3 text-sm text-muted">
          <span class="beacon" aria-hidden="true" />
          Une seule mesure pour l'instant. L'API ne donne pas le passé de cette valeur : la courbe se construira jour après jour.
        </p>
      ) : (
        <div
          class="relative mt-3 h-40"
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const pct = ((e.clientX - r.left) / r.width) * 100;
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(((pct - 2) / 96) * (points.length - 1)))));
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-draw absolute inset-0 size-full overflow-visible">
            {segments.map((d) => (
              <path key={d} d={d} fill="none" stroke="var(--color-win)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
            ))}
          </svg>
          {shown && shown.value !== null && hover !== null && (
            <span
              class="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-white"
              style={{ left: `${x(hover)}%`, top: `${y(shown.value)}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  days: DayStat[];
  history: HistorySnapshot[];
}

export default function ProgressCharts({ days, history }: Props) {
  const [range, setRange] = useState<RangeKey>("30");
  const visibleDays = useMemo(() => filterRange(days, range), [days, range]);
  const weekly = range === "all";
  const buckets = useMemo(() => bucketize(visibleDays, weekly ? 7 : 1), [visibleDays, weekly]);
  const lastDay = days[days.length - 1]?.date;
  const snaps = useMemo(() => {
    if (range === "all" || !lastDay) return history;
    const from = addDays(lastDay, -(Number(range) - 1));
    return history.filter((h) => h.date >= from);
  }, [history, range, lastDay]);

  const games = visibleDays.reduce((n, d) => n + d.games, 0);
  const wins = visibleDays.reduce((n, d) => n + d.wins, 0);
  const rate = winRate(wins, games);

  if (days.length === 0) {
    return <p class="card p-6 text-center text-muted">Pas de données : aucune session n'a encore été collectée.</p>;
  }

  return (
    <div>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Période affichée">
        {RANGES.map((r) => (
          <button key={r.key} type="button" class="chip" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <dl class="mt-5 grid grid-cols-3 gap-3" aria-live="polite">
        {[
          { label: "Parties", value: games, format: fmtInt },
          { label: "Victoires", value: wins, format: fmtInt },
          { label: "Taux de victoire", value: rate, format: fmtPct },
        ].map(({ label, value, format }) => (
          <div key={label} class="card p-3 sm:p-5">
            <dt class="text-xs font-semibold text-muted sm:text-sm">{label}</dt>
            <dd class="tnum mt-1 font-display text-xl font-extrabold sm:text-3xl">
              <AnimatedNumber value={value} format={format} testId={`summary-${label}`} />
              {label === "Taux de victoire" && rate !== null && (
                <div class="meter mt-3" aria-hidden="true">
                  <i style={{ "--v": `${rate}%` }} />
                </div>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <section class="card mt-5 p-4 sm:p-5">
        {/* La clé relance la pousse des barres et le balayage à chaque changement de période. */}
        <GamesChart key={range} buckets={buckets} weekly={weekly} />
        <details class="mt-4">
          <summary class="cursor-pointer font-semibold">Voir le tableau des parties</summary>
          <div class="mt-3 max-h-96 overflow-auto" tabIndex={0} aria-label="Tableau des parties, zone défilante">
            <table class="data-table tnum w-full text-sm">
              <caption class="sr-only">Parties, victoires, défaites et taux par période</caption>
              <thead>
                <tr>
                  <th scope="col">Période</th>
                  <th scope="col" class="num">Parties</th>
                  <th scope="col" class="num">Victoires</th>
                  <th scope="col" class="num">Défaites</th>
                  <th scope="col" class="num">Taux</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.date}>
                    <td>{bucketLabel(b)}{b.partial ? " (en cours)" : ""}</td>
                    <td class="num">{fmtInt(b.games)}</td>
                    <td class="num">{fmtInt(b.wins)}</td>
                    <td class="num">{fmtInt(b.losses)}</td>
                    <td class="num">{fmtPct(b.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <h2 class="section-title mt-12">Au classement officiel</h2>
      <p class="mt-2 max-w-3xl text-sm text-muted">
        Relevés quotidiens du classement, sur sa fenêtre glissante de 90 jours. Ces valeurs ne se comparent donc pas aux parties par jour ci-dessus.
      </p>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <LineChart
          title="Rang"
          invert
          points={snaps.map((h) => ({ date: h.date, value: h.rank }))}
          format={(n) => `${n}${n === 1 ? "er" : "e"}`}
        />
        <LineChart title="Score" points={snaps.map((h) => ({ date: h.date, value: h.score }))} format={fmtScore} />
      </div>
      {snaps.length > 0 && (
        <details class="mt-4">
          <summary class="cursor-pointer font-semibold">Voir le tableau des relevés</summary>
          <div class="mt-3 max-h-96 overflow-auto" tabIndex={0} aria-label="Tableau des relevés, zone défilante">
            <table class="data-table tnum w-full text-sm">
              <caption class="sr-only">Rang et score relevés chaque jour</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" class="num">Rang</th>
                  <th scope="col" class="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...snaps].reverse().map((h) => (
                  <tr key={h.date}>
                    <td>{fmtDay(h.date)}</td>
                    <td class="num">{h.rank === null ? "Hors classement" : h.rank}</td>
                    <td class="num">{fmtScore(h.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
