import LineChart from "./LineChart";
import { fmtDay, fmtScore, NO_DATA } from "../lib/format";
import type { RivalSeries } from "../lib/rivals";

const fmtGap = (n: number) => (n >= 0 ? `${fmtScore(n)} d'avance` : `${fmtScore(-n)} de retard`);
const fmtRank = (n: number) => `${n}${n === 1 ? "er" : "e"}`;

export default function RivalRace({ series }: { series: RivalSeries[] }) {
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  return (
    <div>
      <div class="grid gap-4 md:grid-cols-3">
        {series.map((s) => (
          <LineChart key={s.clanTag} title={`Face à [${s.clanTag}], ${fmtRank(s.rank)}`} points={s.points} format={fmtGap} />
        ))}
      </div>
      <details class="mt-4">
        <summary class="cursor-pointer font-semibold">Voir le tableau des écarts</summary>
        <div class="mt-3 max-h-96 overflow-auto" tabIndex={0} aria-label="Tableau des écarts, zone défilante">
          <table class="data-table tnum w-full text-sm">
            <caption class="sr-only">Écart de score avec chaque clan voisin, relevé chaque jour. Positif : le clan est devant.</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((s) => (
                  <th key={s.clanTag} scope="col" class="num">[{s.clanTag}]</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dates].reverse().map((date) => (
                <tr key={date}>
                  <td>{fmtDay(date)}</td>
                  {series.map((s) => {
                    const value = s.points.find((p) => p.date === date)?.value ?? null;
                    return (
                      <td key={s.clanTag} class="num">
                        {value === null ? NO_DATA : `${value >= 0 ? "+" : "−"}${fmtScore(Math.abs(value))}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
