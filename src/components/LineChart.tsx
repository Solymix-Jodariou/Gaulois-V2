import { useState } from "preact/hooks";
import { fmtDay } from "../lib/format";

export interface LinePoint {
  date: string;
  value: number | null;
}

export default function LineChart({ title, points, invert, format }: { title: string; points: LinePoint[]; invert?: boolean; format: (n: number) => string }) {
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
