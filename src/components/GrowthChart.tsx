import { useState } from "preact/hooks";
import { fmtInt } from "../lib/format";
import { GROWTH_REFERENCE_CAPACITY, gainVersusPeak, peakPercent } from "../lib/growth";

const CAPACITIES = [2_500, 10_000, 25_000, 100_000, 250_000, 1_000_000, 2_500_000];
const FILLS = [10, 20, 35, 42, 50, 65, 80, 100];
const X_TICKS = [0, 25, 50, 75, 100];
const Y_TICKS = [100, 50, 0];
// La zone annoncée par le guide du clan, indépendante de la capacité.
const ZONE = { from: 35, to: 42 };

const gainAt = (fill: number) => gainVersusPeak(fill, GROWTH_REFERENCE_CAPACITY);
const pct = (n: number) => `${fmtInt(n)} %`;
const CURVE = Array.from({ length: 101 }, (_, fill) => gainAt(fill));
const LINE = CURVE.map((gain, fill) => `${fill === 0 ? "M" : "L"}${fill} ${100 - gain}`).join("");
const PEAK = peakPercent(GROWTH_REFERENCE_CAPACITY);

/** La courbe du jeu, calculée : chaque valeur vient de `src/lib/growth.ts`. Le tableau en donne l'équivalent sans survol. */
export default function GrowthChart() {
  const [hover, setHover] = useState<number | null>(null);
  const gain = hover === null ? null : (CURVE[hover] ?? null);

  return (
    <figure class="m-0" data-testid="growth-chart">
      <figcaption class="text-sm font-semibold text-white">Gain de troupes selon le remplissage de votre capacité</figcaption>
      <p class="tnum mt-1 min-h-10 text-sm text-muted sm:min-h-5" aria-hidden="true">
        {hover !== null && gain !== null
          ? `À ${pct(hover)} de la capacité : ${pct(gain)} du gain maximal`
          : `Le gain est au plus haut vers ${pct(PEAK)} de la capacité.`}
      </p>

      <div class="relative mt-7 ml-10 mr-3 select-none" aria-hidden="true">
        <span
          class="tnum absolute -top-6 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-white"
          style={{ left: `${(ZONE.from + ZONE.to) / 2}%` }}
        >
          {ZONE.from} à {pct(ZONE.to)}
        </span>
        <div
          class="relative h-40"
          style={{ touchAction: "pan-y" }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => setHover(fillFromPointer(e))}
          onPointerMove={(e) => setHover(fillFromPointer(e))}
        >
          {Y_TICKS.map((tick) => (
            <div key={tick} class="absolute inset-x-0 border-t border-line" style={{ top: `${100 - tick}%` }}>
              <span class="tnum absolute -top-2 right-full whitespace-nowrap pr-2 text-xs text-muted">{pct(tick)}</span>
            </div>
          ))}
          <div class="absolute inset-y-0 bg-white/15" style={{ left: `${ZONE.from}%`, width: `${ZONE.to - ZONE.from}%` }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="absolute inset-0 size-full overflow-visible">
            <path d={`${LINE}L100 100L0 100Z`} fill="var(--color-win)" fill-opacity="0.1" />
            <path d={LINE} fill="none" stroke="var(--color-win)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          {hover !== null && gain !== null && (
            <>
              <div class="absolute inset-y-0 w-px bg-white/60" style={{ left: `${hover}%` }} />
              <span
                class="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-white"
                style={{ left: `${hover}%`, top: `${100 - gain}%` }}
              />
            </>
          )}
        </div>
        <div class="relative mt-2 h-4 text-xs text-muted">
          {X_TICKS.map((tick) => (
            <span key={tick} class="tnum absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${tick}%` }}>
              {pct(tick)}
            </span>
          ))}
        </div>
      </div>
      <p class="mt-2 ml-10 text-xs text-muted" aria-hidden="true">
        En bas : remplissage de la capacité. À gauche : gain, en part du maximum.
      </p>

      <details class="mt-3">
        <summary>Voir les valeurs</summary>
        <div class="mt-3 grid gap-4 sm:grid-cols-2">
          <table>
            <caption class="sr-only">Gain de troupes selon le remplissage, pour une capacité de {fmtInt(GROWTH_REFERENCE_CAPACITY)} troupes</caption>
            <thead>
              <tr>
                <th scope="col">Remplissage</th>
                <th scope="col">Gain</th>
              </tr>
            </thead>
            <tbody>
              {FILLS.map((fill) => (
                <tr key={fill}>
                  <td>{pct(fill)}</td>
                  <td>{pct(gainAt(fill))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption class="sr-only">Remplissage où le gain est le plus fort, selon la capacité maximale</caption>
            <thead>
              <tr>
                <th scope="col">Capacité max</th>
                <th scope="col">Pic à</th>
              </tr>
            </thead>
            <tbody>
              {CAPACITIES.map((capacity) => (
                <tr key={capacity}>
                  <td>{fmtInt(capacity)}</td>
                  <td>{pct(peakPercent(capacity))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function fillFromPointer(e: PointerEvent): number {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return Math.max(0, Math.min(100, Math.round(((e.clientX - box.left) / box.width) * 100)));
}
