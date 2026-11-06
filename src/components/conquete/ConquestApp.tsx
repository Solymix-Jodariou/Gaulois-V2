import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { basePath, call } from "../../lib/conquete/api";
import { feedDetail, feedText, playerColor } from "../../lib/conquete/feed";
import { BUILDINGS, TERRAIN_LABELS, ranked, troopsForRatio, type BuildingKind } from "../../lib/conquete/rules";
import { ownerLabels } from "../../lib/conquete/shapes";
import type { ClosedSeason, DonorRow, FeedRow, GameMap, GameState, HistoryRow, MyGame, TerritoryState } from "../../lib/conquete/types";
import { fmtClock, fmtDateTime, fmtInt } from "../../lib/format";
import ActionPanel from "./ActionPanel";
import ConquestMap from "./ConquestMap";
import { DiscordButton, Empty, Loading, Problem, messageOf, useMe } from "./common";

/** Quelques octets toutes les 15 secondes : la carte n'est relue que si quelque chose a bougé. */
const PULSE_MS = 15_000;
/** Au moins une relecture complète de temps en temps : la réserve monte toute seule, sans événement. */
const FULL_MS = 5 * 60_000;
const FLASH_MS = 12_000;
const FEED_PAGE = 30;
/** Le classement se pose sur la carte : il ne doit pas la cacher. Le classement complet reste en bas de page. */
const RANKING_ROWS = 6;
/** Le ratio d'attaque de départ : le cinquième de la réserve, comme l'attaque par défaut d'OpenFront. */
const DEFAULT_RATIO = 20;
const RATIO_KEY = "gal-conquete-ratio";
/** Deux clics plus rapprochés que ça sont un double-clic par mégarde : il ne lance rien. */
const FIRE_MIN_GAP_MS = 400;

function readRatio(): number {
  try {
    const saved = Number(localStorage.getItem(RATIO_KEY));
    return saved >= 1 && saved <= 100 ? saved : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}
const NO_TARGETS: ReadonlySet<number> = new Set();
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

/** Le classement par territoire, dans la colonne de la carte : un clic y retrouve le joueur. */
function TerritoryRanking({ rows, total, onPick, mapSize, victoryShare, allies, traitors }: { rows: { key: number; rank: number; name: string; value: number; me: boolean; color: string; anchor: number | undefined }[]; total: number; onPick: (id: number) => void; mapSize: number; victoryShare: number; allies: ReadonlySet<number>; traitors: ReadonlySet<number> }) {
  const top = rows[0]?.value ?? 1;
  return (
    <section data-testid="rank-biggest">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="text-sm font-bold uppercase tracking-wide">Plus grand territoire</h3>
        {rows.length > 0 && <p class="tnum text-xs text-muted">{rows.length > RANKING_ROWS ? `${RANKING_ROWS} premiers sur ${fmtInt(total)}` : plural(total, "joueur", "joueurs")}</p>}
      </div>
      {rows.length === 0 ? (
        <p class="mt-2 text-sm text-muted">Personne pour l'instant.</p>
      ) : (
        <ol class="mt-2 grid gap-1.5">
          {rows.slice(0, RANKING_ROWS).map((r) => (
            <li key={r.key} class={["conq-rank tnum", r.me && "is-me"].filter(Boolean).join(" ")}>
              <button type="button" class="conq-rank-button" onClick={() => r.anchor !== undefined && onPick(r.anchor)}>
                <span class="text-muted">{r.rank}</span>
                <i class="conq-dot" style={{ background: r.color }} aria-hidden="true"></i>
                <span class="truncate font-semibold">
                  {r.name}
                  {allies.has(r.key) && <span class="conq-tag is-ally">allié</span>}
                  {traitors.has(r.key) && <span class="conq-tag is-traitor">traître</span>}
                </span>
                <span>
                  {mapSize > 0 ? `${((r.value / mapSize) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : fmtInt(r.value)}
                  <span class="sr-only"> de la carte, {fmtInt(r.value)} terres</span>
                </span>
                <span class="sr-only"> : trouver sur la carte</span>
              </button>
              <i class="conq-rank-bar" style={{ width: `${Math.max(4, (r.value / top) * 100)}%`, background: r.color }} aria-hidden="true"></i>
            </li>
          ))}
        </ol>
      )}
      {mapSize > 0 && <p class="mt-2 text-xs text-muted">Il faut {Math.round(victoryShare * 100)} % de la carte pour remporter la saison.</p>}
    </section>
  );
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
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [flash, setFlash] = useState<FeedRow | null>(null);
  const [focus, setFocus] = useState(0);
  const [ratio, setRatioState] = useState(readRatio);
  const [fire, setFire] = useState(0);
  const lastPick = useRef({ id: 0, at: 0 });

  const setRatio = (percent: number) => {
    setRatioState(percent);
    try {
      localStorage.setItem(RATIO_KEY, String(percent));
    } catch {
      // Sans stockage, le ratio tient jusqu'au prochain chargement.
    }
  };

  /** La dernière version de la partie lue, et quand. */
  const revision = useRef<string | null>(null);
  const lastFull = useRef(0);
  const lastEvent = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const validated = me?.status === "validated";

  const load = useCallback(async () => {
    try {
      const [pulse, game, events, ranking, seasons] = await Promise.all([
        call<{ revision: string; read_at: string }>("get_game_pulse"),
        call<GameState>("get_game_state"),
        call<{ rows: FeedRow[] }>("get_feed", { p_limit: FEED_PAGE }),
        call<{ rows: DonorRow[] }>("get_donor_ranking"),
        call<{ rows: HistoryRow[] }>("get_season_history"),
      ]);
      revision.current = pulse.revision;
      lastFull.current = Date.now();
      setCheckedAt(pulse.read_at);
      setState(game);
      setFeed(events.rows);
      setFeedMore(events.rows.length === FEED_PAGE);
      setDonors(ranking.rows);
      setHistory(seasons.rows);
      setProblem(null);
      // Un don vient d'arriver : tout le monde le voit passer, sans avoir à regarder le fil.
      const seen = lastEvent.current;
      const gift = seen === null ? undefined : events.rows.find((e) => e.id > seen && e.kind === "donation");
      if (gift) {
        setFlash(gift);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      }
      lastEvent.current = Math.max(seen ?? 0, events.rows[0]?.id ?? 0);
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
    const tick = async () => {
      if (document.hidden) return;
      try {
        const pulse = await call<{ revision: string; read_at: string }>("get_game_pulse");
        setCheckedAt(pulse.read_at);
        if (pulse.revision !== revision.current || Date.now() - lastFull.current >= FULL_MS) await load();
        else setProblem(null);
      } catch (e) {
        setProblem(messageOf(e));
      }
    };
    const timer = setInterval(() => void tick(), PULSE_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(flashTimer.current);
    };
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
  const nameOf = useCallback((owner: number) => playersByNumber.get(owner)?.name ?? "Ancien membre", [playersByNumber]);
  const anchors = useMemo(() => new Map(map ? ownerLabels(map, states).map((l) => [l.owner, l.anchor]) : []), [map, states]);

  const frozen = useMemo(() => new Map<number, TerritoryState>((closed?.territories ?? []).map((t) => [t.id, t])), [closed]);
  const frozenNames = useMemo(() => new Map((closed?.standings ?? []).map((s) => [s.number, s.name])), [closed]);
  const frozenNameOf = useCallback((owner: number) => frozenNames.get(owner) ?? "Ancien membre", [frozenNames]);

  const allies = useMemo(() => {
    const out = new Set<number>();
    for (const a of state?.alliances ?? []) {
      if (a.a === myNumber) out.add(a.b);
      if (a.b === myNumber) out.add(a.a);
    }
    return out;
  }, [state, myNumber]);
  const traitors = useMemo(() => new Set((state?.players ?? []).filter((p) => p.traitor_until && Date.parse(p.traitor_until) > Date.now()).map((p) => p.number)), [state]);
  const myBuildings = useMemo(() => {
    const out: Partial<Record<BuildingKind, number>> = {};
    for (const t of state?.territories ?? []) if (t.owner === myNumber && t.building) out[t.building] = (out[t.building] ?? 0) + 1;
    return out;
  }, [state, myNumber]);

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
        const holder = states.get(n);
        if (!holder || (season.phase === "war" && !allies.has(holder.owner))) out.add(n);
      }
    }
    return out;
  }, [map, season, validated, mine, owned, states, allies]);

  const describe = useCallback(
    (id: number) => {
      const t = map?.territories[id - 1];
      if (!t) return "";
      const s = states.get(id);
      const owner = s ? (playersByNumber.get(s.owner)?.name ?? "Ancien membre") : "Terre libre";
      return `${t.name} · ${TERRAIN_LABELS[t.terrain]} · ${owner}${s ? ` · garnison ${fmtInt(s.garrison)}` : ""}${s?.building ? ` · ${BUILDINGS[s.building].label}` : ""}`;
    },
    [map, states, playersByNumber],
  );

  const onDone = async () => {
    await load();
    await Promise.all([loadMine(), refreshMe()]);
  };

  /** Un clic choisit la terre. Un second clic sur la même lance l'action, sauf un double-clic par mégarde. */
  const pick = (id: number) => {
    const now = Date.now();
    if (id === selected && now - lastPick.current.at > FIRE_MIN_GAP_MS) setFire((n) => n + 1);
    else setSelected(id);
    lastPick.current = { id, at: now };
  };

  const answerAlliance = async (fn: "propose_alliance" | "refuse_alliance", number: number) => {
    try {
      await call(fn, { p_number: number });
      await onDone();
    } catch (e) {
      setProblem(messageOf(e));
    }
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
      <div class="wrap conq-wrap">
        <Problem message={`Jeu indisponible pour l'instant : ${problem}`} onRetry={() => void load()} />
        <p class="mt-2 text-sm text-muted">Cela ne veut pas dire que la carte est vide : ses données n'ont simplement pas pu être lues.</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="wrap conq-wrap">
        <Loading label="Lecture de la carte…" />
      </div>
    );
  }

  /* ---------- Une saison passée : carte figée, lecture seule ---------- */
  if (closed && closedMap) {
    return (
      <div class="wrap conq-wrap" data-testid="closed-season">
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
          targets={NO_TARGETS}
          me={myNumber}
          nameOf={frozenNameOf}
          describe={(id) => {
            const t = closedMap.territories[id - 1];
            const s = frozen.get(id);
            return t ? `${t.name} · ${s ? `${frozenNameOf(s.owner)} · garnison ${fmtInt(s.garrison)}` : "Terre libre"}` : "";
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
  // Un poste de défense couvre sa terre et les voisines du même joueur : le serveur fait le même calcul.
  const chosenFortified = chosen !== null && chosenState !== null && [chosen.id, ...chosen.neighbours].some((id) => {
    const s = states.get(id);
    return s?.owner === chosenState.owner && s.building === "post";
  });
  const reserve = mine?.in_game === false ? (mine.start_troops ?? 0) : (mine?.troops ?? 0);
  const biggest = ranked(state.players ?? [], (p) => p.territories).filter((p) => p.territories > 0);
  const conquerors = ranked((state.players ?? []).filter((p) => p.captured > 0), (p) => p.captured);
  const options = map ? [...map.territories].sort((a, b) => a.name.localeCompare(b.name, "fr")) : [];
  const targetList = map ? [...targets].map((id) => map.territories[id - 1]!).sort((a, b) => a.name.localeCompare(b.name, "fr")) : [];
  const occupied = map && map.territories.length > 0 ? Math.round((states.size / map.territories.length) * 100) : null;
  const feedSection = (
    <>
      <h2 class="section-title">Fil d'actualité</h2>
      <div class="conq-feed-box mt-4" tabIndex={0} role="region" aria-label="Fil d'actualité du jeu">
        <Feed rows={feed} hasMore={feedMore} onMore={() => void moreFeed()} />
      </div>
    </>
  );

  return (
    <div>
      {!season ? (
        <div class="wrap conq-wrap">
          <div class="conq-banner" data-testid="no-season">
            <p>
              <strong>Aucune saison en cours.</strong> La prochaine sera annoncée sur le Discord du clan.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div class="conq-arena" data-testid="arena">
            {map ? (
              <ConquestMap arena map={map} states={states} selected={selected} targets={owned.size > 0 ? targets : NO_TARGETS} me={myNumber} nameOf={nameOf} describe={describe} onSelect={pick} focus={focus} allies={allies} traitors={traitors}>
                <p class="conq-flash" role="status" data-testid="donation-flash">
                  {flash ? feedText(flash) : ""}
                </p>

                <div class="conq-hud conq-hud-left">
                  <div class="conq-panel" data-testid="season-banner">
                    <p class="font-display text-base font-extrabold uppercase">{season.name}</p>
                    <p class="text-sm" data-testid="season-phase">
                      {season.phase === "war" ? "Phase 2 : la guerre" : `Phase 1 : l'expansion${season.war_starts_at ? `, jusqu'au ${fmtDateTime(season.war_starts_at)}` : ""}`}
                    </p>
                    <p class="tnum mt-1 text-xs text-muted">
                      {plural((state.players ?? []).length, "joueur", "joueurs")} · {occupied !== null ? `${occupied} % de la carte occupée` : "…"}
                      <br />
                      <span data-testid="checked-at">Actualisé à {fmtClock(checkedAt ?? state.read_at)}</span>
                    </p>
                  </div>
                  <div class="conq-panel conq-panel-scroll">
                    <TerritoryRanking
                      rows={biggest.map((p) => ({ key: p.number, rank: p.rank, name: p.name, value: p.territories, me: p.number === myNumber, color: playerColor(p.number), anchor: anchors.get(p.number) }))}
                      total={biggest.length}
                      mapSize={map.territories.length}
                      victoryShare={season.config.victoryShare}
                      allies={allies}
                      traitors={traitors}
                      onPick={(id) => {
                        setSelected(id);
                        setFocus((n) => n + 1);
                      }}
                    />
                  </div>
                </div>

                <div class="conq-hud conq-hud-right">
                  {(mine?.alliance_requests ?? []).length > 0 && (
                    <div class="conq-panel" data-testid="alliance-requests">
                      <h3 class="text-sm font-bold">Alliances proposées</h3>
                      <ul class="mt-2 grid gap-2">
                        {(mine?.alliance_requests ?? []).map((r) => (
                          <li key={r.number}>
                            <p class="truncate text-sm font-semibold">{r.name}</p>
                            <div class="mt-1 flex gap-2">
                              <button type="button" class="chip !min-h-9" onClick={() => void answerAlliance("propose_alliance", r.number)}>
                                Accepter
                              </button>
                              <button type="button" class="chip !min-h-9" onClick={() => void answerAlliance("refuse_alliance", r.number)}>
                                Refuser
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div class="conq-panel conq-panel-scroll">
                    <ActionPanel
                      season={season}
                      territory={chosen}
                      state={chosenState}
                      owner={chosenState ? (playersByNumber.get(chosenState.owner) ?? null) : null}
                      me={me}
                      mine={mine}
                      myNumber={myNumber}
                      owned={owned}
                      allies={allies}
                      fortified={chosenFortified}
                      myBuildings={myBuildings}
                      ratio={ratio}
                      onRatio={setRatio}
                      fire={fire}
                      onDone={onDone}
                    />
                  </div>
                </div>

                <div class="conq-hud conq-hud-bottom">
                  {validated && mine ? (
                    <div class="conq-panel conq-command" data-testid="command-bar">
                      <dl class="conq-stats tnum" data-testid="my-reserve">
                        <div class="conq-stat-troops">
                          <dt>Troupes</dt>
                          <dd>
                            <span data-testid="my-troops">{fmtInt(reserve)}</span>
                            {mine.in_game !== false && <span class="conq-of"> / {fmtInt(mine.capacity ?? null)}</span>}
                          </dd>
                          {mine.in_game !== false && (mine.capacity ?? 0) > 0 && (
                            <div class="conq-meter" aria-hidden="true">
                              <i style={{ width: `${Math.min(100, (reserve / (mine.capacity ?? 1)) * 100)}%` }}></i>
                            </div>
                          )}
                        </div>
                        <div>
                          <dt>Par heure</dt>
                          <dd>{mine.in_game === false ? "—" : `+${fmtInt(Math.max(mine.next_regen ?? 0, 0))}`}</dd>
                        </div>
                        <div>
                          <dt>Or</dt>
                          <dd class="conq-gold">
                            <span data-testid="my-gold">{mine.in_game === false ? fmtInt(season.config.gold.start) : fmtInt(mine.gold ?? 0)}</span>
                            {mine.in_game !== false && <span class="conq-of"> +{fmtInt(mine.gold_per_hour ?? 0)}/h</span>}
                          </dd>
                        </div>
                        <div>
                          <dt>Conquêtes</dt>
                          <dd>
                            {mine.expansions_today ?? 0} / {season.config.limits.expansionsPerDay}
                          </dd>
                        </div>
                        <div>
                          <dt>Attaques</dt>
                          <dd>
                            {mine.attacks_today ?? 0} / {season.config.limits.attacksPerDay}
                          </dd>
                        </div>
                      </dl>
                      <div class="conq-ratio">
                        <label for="conq-ratio" class="text-sm font-semibold">
                          Ratio d'attaque
                        </label>
                        <input id="conq-ratio" class="conq-ratio-range" type="range" min={1} max={100} step={1} value={ratio} data-testid="attack-ratio" onInput={(e) => setRatio(Number(e.currentTarget.value))} />
                        <output for="conq-ratio" class="tnum text-sm font-bold" data-testid="attack-ratio-value">
                          {ratio} % · {fmtInt(troopsForRatio(reserve, ratio))}
                        </output>
                      </div>
                    </div>
                  ) : me && !me.signed_in ? (
                    <div class="conq-panel conq-invite">
                      <p>Membre de GAL ? Connectez-vous pour jouer. Les visiteurs suivent la partie en lecture seule.</p>
                      <DiscordButton returnPath="/compte" />
                    </div>
                  ) : me?.signed_in && !validated ? (
                    <div class="conq-panel conq-invite">
                      <p>Votre compte n'est pas encore validé : vous suivez la partie sans pouvoir y jouer.</p>
                      <a class="btn btn-secondary" href={`${basePath()}/compte`}>
                        Voir mon statut
                      </a>
                    </div>
                  ) : null}
                </div>

                {feed.length > 0 && (
                  <ol class="conq-hud conq-ticker" aria-hidden="true">
                    {feed.slice(0, 2).map((e) => (
                      <li key={e.id}>{feedText(e)}</li>
                    ))}
                  </ol>
                )}
              </ConquestMap>
            ) : (
              <div class="wrap conq-wrap">
                <Loading label="Lecture de la carte…" />
              </div>
            )}
          </div>

          <div class="wrap conq-wrap">
            <div class="conq-legend mt-3 text-xs text-muted" data-testid="map-legend">
              <span>
                <i class="conq-swatch is-mine"></i> Vos terres
              </span>
              <span>
                <i class="conq-swatch is-target"></i> À votre portée
              </span>
              <span>
                <i class="conq-swatch is-ally"></i> Vos alliés
              </span>
              {(Object.keys(BUILDINGS) as BuildingKind[]).map((kind) => (
                <span key={kind}>
                  <b class="conq-build-mark" aria-hidden="true">
                    {BUILDINGS[kind].mark}
                  </b>
                  {BUILDINGS[kind].label}
                </span>
              ))}
              <span>Molette ou deux doigts pour zoomer. Glisser pour se déplacer.</span>
            </div>
            {validated && mine && season.config.troopsPerCapsule > 0 && (
              <p class="mt-2 text-xs text-muted" data-testid="donation-rule">
                {fmtInt(mine.capsules)} capsules validées. 1 capsule donnée pendant la saison = {plural(season.config.troopsPerCapsule, "troupe", "troupes")} en renfort, dès que le don est validé, dans la limite de votre capacité.
              </p>
            )}

            <div class="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section class="conq-board-feed">{feedSection}</section>
              <section>
                <h2 class="section-title">Toutes les terres</h2>
                <label for="conq-pick" class="mt-4 block text-sm font-semibold">
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
              </section>
            </div>
          </div>
        </>
      )}

      <div class="wrap conq-wrap">
      {season && (
        <div class="mt-8 grid gap-4 md:grid-cols-2">
          <Ranking title="Meilleurs conquérants" unit="prises" testid="rank-conquerors" rows={conquerors.map((p) => ({ key: p.number, rank: p.rank, name: p.name, value: p.captured, me: p.number === myNumber, color: playerColor(p.number) }))} />
          <Ranking title="Plus gros donneurs" unit="capsules" testid="rank-donors" rows={donors.map((d, i) => ({ key: i, rank: d.rank, name: d.name ?? "Anonyme", value: d.total, me: d.me }))} />
        </div>
      )}

      <div class={season ? "mt-8" : "mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]"}>
        {!season && <section>{feedSection}</section>}
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
    </div>
  );
}
