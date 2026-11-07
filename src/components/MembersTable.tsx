import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { fmtDate, fmtInt, fmtPct } from "../lib/format";
import { motionAllowed } from "../lib/fx/motion";
import { filterMembers, gamesOf, rateOf, sortMembers, type SortDir, type SortKey } from "../lib/members";
import type { StoredMember, StoredMembers } from "../lib/schemas";

const PAGE = 50;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ROLE: Record<StoredMember["role"], string> = { leader: "Chef", officer: "Officier", member: "Membre" };
const SORTS: { key: SortKey; label: string }[] = [
  { key: "wins", label: "Victoires" },
  { key: "games", label: "Parties" },
  { key: "rate", label: "Taux" },
  { key: "joinedAt", label: "Arrivée" },
];

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: StoredMembers };

function Name({ m }: { m: StoredMember }) {
  if (!m.username) return <span class="text-muted italic">Membre anonyme</span>;
  return (
    <a
      class="font-semibold underline-offset-2 hover:underline"
      href={`${BASE}/membres/${encodeURIComponent(m.publicId ?? "")}`}
    >
      {m.username}
    </a>
  );
}

function RoleBadge({ role }: { role: StoredMember["role"] }) {
  if (role === "member") return null;
  return <span class="ml-2 rounded border border-line px-1.5 py-0.5 text-xs font-semibold text-muted">{ROLE[role]}</span>;
}

/** « — » : pas de stats reçues. Zéro partie : affiché tel quel, sans taux. */
const wlText = (m: StoredMember) =>
  m.team === null ? "Pas de données" : gamesOf(m) === 0 ? "Aucune partie sous le tag" : null;

const memberKey = (m: StoredMember) => m.publicId ?? `anon-${m.joinedAt}`;
/** Au-delà, on ne fait plus glisser les lignes : le gain visuel ne vaut pas le coût. */
const FLIP_MAX_ROWS = 150;

/** Après un tri, chaque ligne glisse de son ancienne place vers la nouvelle. */
function useGlidingRows(container: { current: HTMLElement | null }, change: unknown): void {
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) {
      tops.current.clear();
      return;
    }
    const rows = [...el.children] as HTMLElement[];
    const next = new Map<string, number>();
    const animate = rows.length <= FLIP_MAX_ROWS && motionAllowed();
    for (const row of rows) {
      const key = row.dataset.key;
      if (!key) continue;
      const top = row.offsetTop;
      next.set(key, top);
      const before = tops.current.get(key);
      if (animate && before !== undefined && before !== top) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
          duration: 480,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    tops.current = next;
  }, [change]);
}

export default function MembersTable({ src }: { src: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("wins");
  const [dir, setDir] = useState<SortDir>("desc");
  const [limit, setLimit] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: StoredMembers) => {
        // Le fichier a déjà été validé par Zod à la collecte et au build.
        if (cancelled) return;
        setState(Array.isArray(json?.members) ? { status: "ready", data: json } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [src, attempt]);

  const members = state.status === "ready" ? state.data.members : [];
  const rows = useMemo(() => sortMembers(filterMembers(members, query), sort, dir), [members, query, sort, dir]);

  useEffect(() => setLimit(PAGE), [query, sort, dir]);

  const tableBody = useRef<HTMLTableSectionElement>(null);
  const cardList = useRef<HTMLUListElement>(null);
  const shownRows = rows.slice(0, limit);
  useGlidingRows(tableBody, shownRows);
  useGlidingRows(cardList, shownRows);

  const toggleSort = (key: SortKey) => {
    if (key === sort) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(key);
      setDir("desc");
    }
  };

  if (state.status === "loading") {
    return (
      <div class="card flex items-center justify-center gap-3 p-10 text-muted" role="status">
        <svg class="loader" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke-width="4">
          <path d="M6 28A16 16 0 0 1 12 6" stroke="#0B5FFF" />
          <path d="M15 4.700A16 16 0 0 1 25 4.700" stroke="#fff" />
          <path d="M28 6A16 16 0 0 1 34 28" stroke="#FF1A2E" />
        </svg>
        Chargement de la liste des membres…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div class="card p-6 text-center" role="alert">
        <p class="font-semibold">La liste des membres n'a pas pu être chargée.</p>
        <button type="button" class="btn btn-ghost mt-3" onClick={() => setAttempt(attempt + 1)}>Réessayer</button>
      </div>
    );
  }
  if (members.length === 0) {
    return <p class="card p-6 text-center text-muted">Pas de données : aucune liste de membres n'a encore été collectée.</p>;
  }

  const visible = rows.slice(0, limit);
  const named = members.filter((m) => m.username).length;

  return (
    <div>
      <p class="tnum text-sm text-muted">
        {fmtInt(state.data.total)} membres dans la liste officielle, dont {fmtInt(members.length - named)} sans pseudo public.
      </p>
      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label class="block flex-1 sm:max-w-sm" htmlFor="member-search">
          <span class="mb-1 block text-sm font-semibold">Rechercher par pseudo</span>
          <input id="member-search" class="field" type="search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <div class="flex items-end gap-2 md:hidden">
          <label class="block flex-1" htmlFor="member-sort">
            <span class="mb-1 block text-sm font-semibold">Trier par</span>
            <select id="member-sort" class="field" value={sort} onChange={(e) => setSort(e.currentTarget.value as SortKey)}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button type="button" class="btn btn-ghost" onClick={() => setDir(dir === "desc" ? "asc" : "desc")}>
            {dir === "desc" ? "Décroissant" : "Croissant"}
          </button>
        </div>
      </div>
      <p class="tnum mt-2 text-sm text-muted" role="status" data-testid="member-count">
        {fmtInt(rows.length)} résultat{rows.length > 1 ? "s" : ""}, {fmtInt(visible.length)} affiché{visible.length > 1 ? "s" : ""}
      </p>

      {rows.length === 0 ? (
        <p class="card mt-4 p-5 text-muted">Aucun pseudo ne correspond à « {query.trim()} ». Les membres anonymes ne peuvent pas être recherchés.</p>
      ) : (
        <>
          <div class="card mt-4 hidden overflow-hidden md:block">
            <table class="data-table tnum w-full text-sm">
              <caption class="sr-only">Membres du clan et leurs parties d'équipe sous le tag</caption>
              <thead>
                <tr>
                  <th scope="col">Membre</th>
                  {SORTS.map((s) => (
                    <th key={s.key} scope="col" class={s.key === "joinedAt" ? "" : "num"} aria-sort={sort === s.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" class="uppercase hover:text-white" onClick={() => toggleSort(s.key)}>
                        {s.label} {sort === s.key ? (dir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={tableBody}>
                {visible.map((m, i) => {
                  const rate = rateOf(m);
                  return (
                    <tr key={memberKey(m)} class="fx-row" data-key={memberKey(m)} data-testid="member-row" style={{ "--i": Math.min(i, 18) }}>
                      <td><Name m={m} /><RoleBadge role={m.role} /></td>
                      <td class="num">{m.team ? fmtInt(m.team.wins) : "—"}</td>
                      <td class="num">{fmtInt(gamesOf(m))}</td>
                      <td class="num">
                        {rate !== null && <span class="score-bar" aria-hidden="true" style={{ width: `${rate}%`, "--i": Math.min(i, 18) }} />}
                        <span class="relative">{fmtPct(rate)}</span>
                      </td>
                      <td>{fmtDate(m.joinedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul class="mt-4 space-y-2 md:hidden" ref={cardList}>
            {visible.map((m, i) => {
              const note = wlText(m);
              return (
                <li key={memberKey(m)} class="fx-row card tnum p-3" data-key={memberKey(m)} data-testid="member-card" style={{ "--i": Math.min(i, 18) }}>
                  <p><Name m={m} /><RoleBadge role={m.role} /></p>
                  <p class="mt-1 text-sm">
                    {note ?? `${fmtInt(m.team?.wins)} victoires · ${fmtInt(gamesOf(m))} parties · ${fmtPct(rateOf(m))}`}
                  </p>
                  <p class="mt-1 text-xs text-muted">Arrivé·e le {fmtDate(m.joinedAt)}</p>
                </li>
              );
            })}
          </ul>

          {visible.length < rows.length && (
            <div class="mt-4 text-center">
              <button type="button" class="btn btn-ghost" onClick={() => setLimit(limit + PAGE)}>Afficher {Math.min(PAGE, rows.length - visible.length)} de plus</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
