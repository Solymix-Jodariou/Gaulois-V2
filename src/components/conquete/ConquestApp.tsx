import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { basePath, call } from "../../lib/conquete/api";
import { feedDetail, feedText, playerColor } from "../../lib/conquete/feed";
import { TERRAIN_LABELS, ranked } from "../../lib/conquete/rules";
import type { ClosedSeason, DonorRow, FeedRow, GameMap, GameState, HistoryRow, MyGame, TerritoryState } from "../../lib/conquete/types";
import { fmtDateTime, fmtInt } from "../../lib/format";
import ActionPanel from "./ActionPanel";
import ConquestMap from "./ConquestMap";
import { DiscordButton, Empty, Loading, Problem, messageOf, useMe } from "./common";

const REFRESH_MS = 60_000;
const FEED_PAGE = 30;
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n > 1 ? many : one}`;

const maps = new Map<string, Promise<GameMap>>();
function loadMap(version: string): Promise<GameMap> {
  let map = maps.get(version);
  if (!map) {
    map = fetch(`${basePath()}/conquete/map-${version}.json`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<GameMap>;
    });
    maps.set(version, map);
    map.catch(() => maps.delete(version));
  }
  return map;
}

function Ranking({ title, rows, unit, testid }: { title: string; rows: { key: string | number; rank: number; name: string; value: number; me?: boolean; color?: string }[]; unit: string; testid: string }) {
  return (
    <section class="card p-5" data-testid={testid}>
      <h3 class="text-lg">{title}</h3>
      {rows.length === 0 ? (
        <p class="mt-3 text-sm text-muted">Personne pour l'instant.</p>
      ) : (
        <ol class="mt-3 grid gap-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} class={["conq-rank tnum", r.me && "is-me"].filter(Boolean).join(" ")}>
              <span class="text-muted">{r.rank}</span>
              {r.color && <i class="conq-dot" style={{ background: r.color }} aria-hidden="true"></i>}
              <span class="truncate font-semibold">{r.name}</span>
              <span>
                {fmtInt(r.value)} <span class="text-xs text-muted">{unit}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Feed({ rows, onMore, hasMore }: { rows: FeedRow[]; onMore?: () => void; hasMore: boolean }) {
  if (rows.length === 0) return <Empty>Rien pour l'instant : le premier à bouger écrit l'histoire.</Empty>;
  return (
    <>
      <ol class="conq-feed" data-testid="game-feed">
        {rows.map((e) => {
          const detail = feedDetail(e);
          return (
            <li key={e.id}>
              <time class="tnum text-xs text-muted" dateTime={e.at}>
                {fmtDateTime(e.at)}
              </time>
              <p class="font-semibold">{feedText(e)}</p>
              {detail && <p class="tnum text-xs text-muted">{detail}</p>}
            </li>
          );
        })}
      </ol>
      {hasMore && onMore && (
        <button type="button" class="chip mt-3" onClick={onMore}>
          Voir plus
        </button>
      )}
    </>
  );
}

export default function ConquestApp() {
  const { me, refresh: refreshMe } = useMe();
  const [state, setState] = useState<GameState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [map, setMap] = useState<GameMap | null>(null);
  const [mine, setMine] = useState<MyGame | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [feedMore, setFeedMore] = useState(false);
  const [donors, setDonors] = useState<DonorRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [closed, setClosed] = useState<ClosedSeason | null>(null);
  const [closedMap, setClosedMap] = useState<GameMap | null>(null);

  const validated = me?.status === "validated";

  const load = useCallback(async () => {
    try {
      const [game, events, ranking, seasons] = await Promise.all([
        call<GameState>("get_game_state"),
        call<{ rows: FeedRow[] }>("get_feed", { p_limit: FEED_PAGE }),
        call<{ rows: DonorRow[] }>("get_donor_ranking"),
        call<{ rows: HistoryRow[] }>("get_season_history"),
      ]);
      setState(game);
      setFeed(events.rows);
      setFeedMore(events.rows.length === FEED_PAGE);
      setDonors(ranking.rows);
      setHistory(seasons.rows);
      setProblem(null);
      if (game.season) setMap(await loadMap(game.season.map_version));
    } catch (e) {
      setProblem(messageOf(e));
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (!validated) {
      setMine(null);
      return;
    }
    try {
      setMine(await call<MyGame>("get_my_game"));
    } catch {
      setMine(null);
    }
  }, [validated]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadMine();
  }, [loadMine, state?.read_at]);

  const moreFeed = async () => {
    const last = feed.at(-1);
    if (!last) return;
    const events = await call<{ rows: FeedRow[] }>("get_feed", { p_before: last.id, p_limit: FEED_PAGE }).catch(() => ({ rows: [] }));
    setFeed([...feed, ...events.rows]);
    setFeedMore(events.rows.length === FEED_PAGE);
  };

  const season = state?.season ?? null;
  const myNumber = state?.me ?? me?.number ?? null;

  const states = useMemo(() => new Map<number, TerritoryState>((state?.territories ?? []).map((t) => [t.id, t])), [state]);
  const owned = useMemo(() => new Set((state?.territories ?? []).filter((t) => t.owner === myNumber).map((t) => t.id)), [state, myNumber]);
  const playersByNumber = useMemo(() => new Map((state?.players ?? []).map((p) => [p.number, p])), [state]);

  const targets = useMemo(() => {
    const out = new Set<number>();
    if (!map || !season || !validated || mine?.excluded) return out;
    if (owned.size === 0) {
      for (const t of map.territories) if (!states.has(t.id)) out.add(t.id);
      return out;
    }
    for (const id of owned) {
      for (const n of map.territories[id - 1]?.neighbours ?? []) {
        if (owned.has(n)) continue;
        if (!states.has(n) || season.phase === "war") out.add(n);
      }
    }
    return out;
  }, [map, season, validated, mine, owned, states]);

  const describe = useCallback(
    (id: number) => {
      const t = map?.territories[id - 1];
      if (!t) return "";
      const s = states.get(id);
      const owner = s ? (playersByNumber.get(s.owner)?.name ?? "Ancien membre") : "Terre libre";
      return `${t.name} · ${TERRAIN_LABELS[t.terrain]} · ${owner}${s ? ` · garnison ${fmtInt(s.garrison)}` : ""}`;
    },
    [map, states, playersByNumber],
  );

  const onDone = async () => {
    await load();
    await Promise.all([loadMine(), refreshMe()]);
  };

  const openClosed = async (id: number) => {
    try {
      const data = await call<ClosedSeason & { ok: boolean }>("get_closed_season", { p_season: id });
      setClosedMap(await loadMap(data.map_version));
      setClosed(data);
      setSelected(null);
    } catch (e) {
      setProblem(messageOf(e));
    }
  };

  if (problem && !state) {
    return (
      <div class="wrap">
        <Problem message={`Jeu indisponible pour l'instant : ${problem}`} onRetry={() => void load()} />
        <p class="mt-2 text-sm text-muted">Cela ne veut pas dire que la carte est vide : ses données n'ont simplement pas pu être lues.</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="wrap">
        <Loading label="Lecture de la carte…" />
      </div>
    );
  }

  /* ---------- Une saison passée : carte figée, lecture seule ---------- */
  if (closed && closedMap) {
    const frozen = new Map<number, TerritoryState>(closed.territories.map((t) => [t.id, t]));
    const names = new Map(closed.standings.map((s) => [s.number, s.name]));
    return (
      <div class="wrap" data-testid="closed-season">
        <div class="conq-banner">
          <p>
            <strong>{closed.name}</strong> : carte figée le {closed.closed_at ? fmtDateTime(closed.closed_at) : "—"}, heure de Paris.
          </p>
          <button type="button" class="chip" onClick={() => setClosed(null)}>
            Retour à la saison en cours
          </button>
        </div>
        <ConquestMap
          map={closedMap}
          states={frozen}
          selected={null}
          targets={new Set()}
          me={myNumber}
          describe={(id) => {
            const t = closedMap.territories[id - 1];
            const s = frozen.get(id);
            return t ? `${t.name} · ${s ? `${names.get(s.owner) ?? "Ancien membre"} · garnison ${fmtInt(s.garrison)}` : "Terre libre"}` : "";
          }}
          onSelect={() => {}}
        />
        <div class="mt-6 grid gap-4 md:grid-cols-3">
          <Ranking title="Plus grand territoire" unit="terres" testid="final-biggest" rows={ranked(closed.standings, (s) => s.territories).map((s) => ({ key: s.number, rank: s.rank, name: s.name, value: s.territories, color: playerColor(s.number) }))} />
          <Ranking title="Meilleurs conquérants" unit="prises" testid="final-conquerors" rows={ranked(closed.standings.filter((s) => s.captured > 0), (s) => s.captured).map((s) => ({ key: s.number, rank: s.rank, name: s.name, value: s.captured, color: playerColor(s.number) }))} />
          <Ranking title="Plus gros donneurs" unit="capsules" testid="final-donors" rows={closed.donors.map((d, i) => ({ key: i, rank: d.rank, name: d.name ?? "Anonyme", value: d.total }))} />
        </div>
      </div>
    );
  }

  const chosen = selected !== null && map ? (map.territories[selected - 1] ?? null) : null;
  const chosenState = selected !== null ? (states.get(selected) ?? null) : null;
  const biggest = ranked(state.players ?? [], (p) => p.territories).filter((p) => p.territories > 0);
  const conquerors = ranked((state.players ?? []).filter((p) => p.captured > 0), (p) => p.captured);
  const options = map ? [...map.territories].sort((a, b) => a.name.localeCompare(b.name, "fr")) : [];
  const targetList = map ? [...targets].map((id) => map.territories[id - 1]!).sort((a, b) => a.name.localeCompare(b.name, "fr")) : [];

  return (
    <div class="wrap">
      {!season ? (
        <div class="conq-banner" data-testid="no-season">
          <p>
            <strong>Aucune saison en cours.</strong> La prochaine sera annoncée sur le Discord du clan.
          </p>
        </div>
      ) : (
        <>
          <div class="conq-banner" data-testid="season-banner">
            <div>
              <p class="font-display text-xl font-extrabold uppercase">{season.name}</p>
              <p class="text-sm" data-testid="season-phase">
                {season.phase === "war" ? "Phase 2 : la guerre" : `Phase 1 : l'expansion${season.war_starts_at ? `, jusqu'au ${fmtDateTime(season.war_starts_at)}` : ""}`}
              </p>
            </div>
            <p class="tnum text-xs text-muted">
              {plural((state.players ?? []).length, "joueur", "joueurs")} · {plural(states.size, "territoire occupé", "territoires occupés")} sur {map?.territories.length ?? "…"}
              <br />
              Relu à {fmtDateTime(state.read_at)}, heure de Paris.
            </p>
          </div>

          {validated && mine && (
            <dl class="conq-stats tnum" data-testid="my-reserve">
              <div>
                <dt>Ma réserve</dt>
                <dd data-testid="my-troops">{fmtInt(mine.in_game === false ? (mine.start_troops ?? 0) : (mine.troops ?? 0))}</dd>
              </div>
              <div>
                <dt>Capacité</dt>
                <dd>{mine.in_game === false ? "—" : fmtInt(mine.capacity ?? null)}</dd>
              </div>
              <div>
                <dt>Prochain gain</dt>
                <dd>{mine.in_game === false ? "—" : `+${fmtInt(Math.max(mine.next_regen ?? 0, 0))} / h`}</dd>
              </div>
              <div>
                <dt>Mes capsules validées</dt>
                <dd>{fmtInt(mine.capsules)}</dd>
              </div>
              <div>
                <dt>Conquêtes du jour</dt>
                <dd>
                  {mine.expansions_today ?? 0} / {season.config.limits.expansionsPerDay}
                </dd>
              </div>
              <div>
                <dt>Attaques du jour</dt>
                <dd>
                  {mine.attacks_today ?? 0} / {season.config.limits.attacksPerDay}
                </dd>
              </div>
            </dl>
          )}

          {me && !me.signed_in && (
            <div class="conq-invite">
              <p>Membre de GAL ? Connectez-vous pour jouer. Les visiteurs peuvent suivre la partie en lecture seule.</p>
              <DiscordButton returnPath="/compte" />
            </div>
          )}
          {me?.signed_in && !validated && (
            <div class="conq-invite">
              <p>Votre compte n'est pas encore validé : vous suivez la partie sans pouvoir y jouer.</p>
              <a class="btn btn-secondary" href={`${basePath()}/compte`}>
                Voir mon statut
              </a>
            </div>
          )}

          <div class="conq-board">
            <div>
              {map ? <ConquestMap map={map} states={states} selected={selected} targets={targets} me={myNumber} describe={describe} onSelect={setSelected} /> : <Loading label="Lecture de la carte…" />}
              <div class="conq-legend text-xs text-muted">
                <span>
                  <i class="conq-swatch is-free"></i> Terre libre
                </span>
                <span>
                  <i class="conq-swatch is-mine"></i> Vos terres
                </span>
                <span>
                  <i class="conq-swatch is-target"></i> À votre portée
                </span>
                <span>^ Colline : plus chère à prendre</span>
                <span>^^ Montagne : plus chère encore</span>
              </div>
            </div>
            <aside class="conq-side">
              <ActionPanel season={season} territory={chosen} state={chosenState} owner={chosenState ? (playersByNumber.get(chosenState.owner) ?? null) : null} me={me} mine={mine} myNumber={myNumber} owned={owned} onDone={onDone} />
              <div class="mt-5 border-t border-line pt-4">
                <label for="conq-pick" class="text-sm font-semibold">
                  Aller à un territoire
                </label>
                <select id="conq-pick" class="field mt-1" value={selected ?? ""} data-testid="territory-select" onChange={(e) => setSelected(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
                  <option value="">Choisir…</option>
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {targetList.length > 0 && owned.size > 0 && (
                  <details class="mt-3" open={targetList.length <= 12}>
                    <summary class="cursor-pointer text-sm font-semibold">Cibles possibles ({targetList.length})</summary>
                    <ul class="conq-targets mt-2" data-testid="target-list">
                      {targetList.map((t) => {
                        const s = states.get(t.id);
                        return (
                          <li key={t.id}>
                            <button type="button" class="chip !min-h-9" aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}>
                              {t.name}
                              {s ? ` · ${fmtInt(s.garrison)}` : ""}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      {season && (
        <div class="mt-8 grid gap-4 md:grid-cols-3">
          <Ranking title="Plus grand territoire" unit="terres" testid="rank-biggest" rows={biggest.map((p) => ({ key: p.number, rank: p.rank, name: p.name, value: p.territories, me: p.number === myNumber, color: playerColor(p.number) }))} />
          <Ranking title="Meilleurs conquérants" unit="prises" testid="rank-conquerors" rows={conquerors.map((p) => ({ key: p.number, rank: p.rank, name: p.name, value: p.captured, me: p.number === myNumber, color: playerColor(p.number) }))} />
          <Ranking title="Plus gros donneurs" unit="capsules" testid="rank-donors" rows={donors.map((d, i) => ({ key: i, rank: d.rank, name: d.name ?? "Anonyme", value: d.total, me: d.me }))} />
        </div>
      )}

      <div class="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 class="section-title">Fil d'actualité</h2>
          <div class="mt-4">
            <Feed rows={feed} hasMore={feedMore} onMore={() => void moreFeed()} />
          </div>
        </section>
        <section data-testid="season-history">
          <h2 class="section-title">Saisons passées</h2>
          {history.length === 0 ? (
            <p class="mt-4 text-muted">Aucune saison terminée pour l'instant.</p>
          ) : (
            <ul class="mt-4 grid gap-3">
              {history.map((h) => (
                <li key={h.id} class="card p-4">
                  <p class="font-semibold">{h.name}</p>
                  <p class="tnum text-sm text-muted">
                    Terminée le {h.closed_at ? fmtDateTime(h.closed_at) : "—"}
                    {h.biggest ? ` · Plus grand territoire : ${h.biggest.name}` : ""}
                    {h.conqueror ? ` · Conquérant : ${h.conqueror.name}` : ""}
                  </p>
                  <button type="button" class="chip mt-2" onClick={() => void openClosed(h.id)}>
                    Voir la carte finale
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {problem && (
        <div class="mt-4">
          <Problem message={`Dernière lecture impossible : ${problem} Les chiffres affichés datent de la lecture précédente.`} onRetry={() => void load()} />
        </div>
      )}
    </div>
  );
}
