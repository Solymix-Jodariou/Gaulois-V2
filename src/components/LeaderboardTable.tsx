import { useMemo, useState } from "preact/hooks";
import { fmtInt, fmtPct, fmtScore } from "../lib/format";
import { searchClans, winRate, type RankedClan } from "../lib/stats";

interface Props {
  clans: RankedClan[];
  tag: string;
}

export default function LeaderboardTable({ clans, tag }: Props) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => searchClans(clans, query), [clans, query]);

  return (
    <div>
      <label class="block max-w-sm" htmlFor="clan-search">
        <span class="mb-1 block text-sm font-semibold">Rechercher un clan</span>
        <input
          id="clan-search"
          class="field"
          type="search"
          placeholder="Tag du clan, par exemple GAL"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>
      <p class="tnum mt-2 text-sm text-muted" role="status">
        {rows.length} clan{rows.length > 1 ? "s" : ""} sur {clans.length}
      </p>

      {rows.length === 0 ? (
        <p class="card mt-4 p-5 text-muted">Aucun clan ne correspond à « {query.trim()} » dans la liste officielle.</p>
      ) : (
        <>
          <div class="card mt-4 hidden overflow-hidden md:block">
            <table class="data-table tnum w-full text-sm">
              <caption class="sr-only">Classement officiel des clans OpenFront</caption>
              <thead>
                <tr>
                  <th scope="col">Rang</th>
                  <th scope="col">Clan</th>
                  <th scope="col" class="num">Score</th>
                  <th scope="col" class="num">Parties</th>
                  <th scope="col" class="num">Victoires</th>
                  <th scope="col" class="num">Défaites</th>
                  <th scope="col" class="num">Taux</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.clanTag} class={c.clanTag === tag ? "row-highlight font-semibold" : ""}>
                    <td>{c.rank}</td>
                    <td class="font-display font-bold">[{c.clanTag}]</td>
                    <td class="num">{fmtScore(c.weightedWins)}</td>
                    <td class="num">{fmtInt(c.games)}</td>
                    <td class="num">{fmtInt(c.wins)}</td>
                    <td class="num">{fmtInt(c.losses)}</td>
                    <td class="num">{fmtPct(winRate(c.wins, c.games))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ol class="mt-4 space-y-2 md:hidden" aria-label="Classement officiel des clans OpenFront">
            {rows.map((c) => (
              <li key={c.clanTag} class={`card tnum p-3 ${c.clanTag === tag ? "row-highlight" : ""}`} value={c.rank}>
                <div class="flex items-baseline justify-between gap-3">
                  <p class="font-display text-lg font-bold">
                    <span class="mr-2 text-muted">{c.rank}</span>[{c.clanTag}]
                  </p>
                  <p class="font-semibold">{fmtScore(c.weightedWins)}</p>
                </div>
                <p class="mt-1 text-sm text-muted">
                  {fmtInt(c.games)} parties · {fmtInt(c.wins)} victoires · {fmtPct(winRate(c.wins, c.games))}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
