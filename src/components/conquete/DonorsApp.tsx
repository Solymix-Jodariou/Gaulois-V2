import { useEffect, useState } from "preact/hooks";
import { basePath, call } from "../../lib/conquete/api";
import type { DonationSync, DonorRow } from "../../lib/conquete/types";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { Loading, Problem, messageOf } from "./common";

interface Ranking {
  rows: DonorRow[];
  season: string | null;
  sync: DonationSync | null;
  read_at: string;
}

export default function DonorsApp() {
  const [data, setData] = useState<Ranking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setData(await call<Ranking>("get_donor_ranking"));
    } catch (e) {
      setError(messageOf(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error && !data) return <Problem message={`Classement indisponible pour l'instant : ${error}`} onRetry={() => void load()} />;
  if (!data) return <Loading label="Lecture du classement…" />;

  return (
    <div data-testid="donors">
      <p class="tnum text-sm text-muted" data-testid="donors-read-at">
        Relu le {fmtDateTime(data.read_at)}, heure de Paris.
        {data.sync ? ` Dons lus chez OpenFront, dernière lecture le ${fmtDateTime(data.sync.read_at)}.` : " Dons validés un à un par les officiers."}
      </p>
      {data.rows.length === 0 ? (
        <p class="card mt-4 p-5" data-testid="donors-empty">
          Aucun don {data.sync ? "lu" : "validé"} pour l'instant. Cela ne veut pas dire que personne n'a donné : {data.sync ? "un don apparaît ici une fois son auteur validé sur le site." : "les dons apparaissent ici une fois déclarés et validés par un officier."}
        </p>
      ) : (
        <div class="card mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Classement des donneurs">
          <table class="data-table w-full" data-testid="donors-table">
            <thead>
              <tr>
                <th scope="col">Rang</th>
                <th scope="col">Donneur</th>
                <th scope="col" class="num">
                  Total
                </th>
                <th scope="col" class="num">
                  Saison en cours
                </th>
                <th scope="col" class="num">
                  30 derniers jours
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} class={r.me ? "row-highlight" : undefined} data-testid="donor-row">
                  <td class="tnum">{r.rank}</td>
                  <td class="font-semibold">
                    {r.name ?? <span class="text-muted">Anonyme</span>}
                    {r.me ? " (vous)" : ""}
                  </td>
                  <td class="num tnum">{fmtInt(r.total)}</td>
                  <td class="num tnum">{r.season === null ? "—" : fmtInt(r.season)}</td>
                  <td class="num tnum">{r.recent > 0 ? `+${fmtInt(r.recent)}` : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="mt-4">
        <a href={`${basePath()}/compte`}>{data.sync ? "Choisir d'apparaître sous mon nom" : "Déclarer un don ou choisir d'apparaître sous mon nom"}</a>
      </p>
    </div>
  );
}
