import { useEffect, useMemo, useState } from "preact/hooks";
import { basePath, call, newRequestId, proofUrl, removeProof } from "../../lib/conquete/api";
import { CONFIG_LABELS, flattenConfig, withValue, type ConfigValue } from "../../lib/conquete/config-labels";
import { DEFAULT_CONFIG, type ConquestConfig } from "../../lib/conquete/rules";
import { ROLE_LABELS, type DonationRow, type ExcludedRow, type LogRow, type Me, type MemberRow, type RequestRow, type Role, type SeasonRow } from "../../lib/conquete/types";
import { fmtDate, fmtDateTime, fmtInt } from "../../lib/format";
import { DiscordButton, Empty, Loading, Problem, Success, messageOf, useMe } from "./common";

type Tab = "requests" | "donations" | "members" | "moderation" | "seasons" | "log";

/** L'affichage suit le rôle, mais chaque fonction du serveur revérifie : masquer un onglet ne protège rien. */
const TABS: { id: Tab; label: string; rank: number }[] = [
  { id: "requests", label: "Demandes", rank: 2 },
  { id: "donations", label: "Dons", rank: 2 },
  { id: "members", label: "Membres", rank: 2 },
  { id: "moderation", label: "Modération", rank: 2 },
  { id: "seasons", label: "Saisons", rank: 3 },
  { id: "log", label: "Journal", rank: 3 },
];

const STATUS_LABELS = { pending: "En attente", validated: "Validé", suspended: "Suspendu" } as const;
const SEASON_LABELS = { draft: "Brouillon", expansion: "Expansion", war: "Guerre", closed: "Terminée" } as const;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

/** Lit une liste du serveur et donne de quoi la relire après une action. */
function useList<T>(fn: string, args: Record<string, unknown> = {}) {
  const key = JSON.stringify(args);
  const [rows, setRows] = useState<T[] | null>(null);
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    try {
      const data = await call<{ rows: T[] }>(fn, JSON.parse(key) as Record<string, unknown>);
      setRows(data.rows);
      setExtra(data as unknown as Record<string, unknown>);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  useEffect(() => {
    void reload();
    // Relit quand les arguments changent.
  }, [fn, key]);
  return { rows, extra, error, reload };
}

/** Exécute une action, affiche le refus du serveur ou un message de réussite, puis relit. */
function useAction(after: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(success);
      await after();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

function Requests() {
  const list = useList<RequestRow>("list_membership_requests");
  const action = useAction(list.reload);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const roster = list.extra["roster"] as { total: number; read_at: string } | null | undefined;

  return (
    <div data-testid="admin-requests">
      <p class="text-sm text-muted">
        {roster ? `Liste officielle relue le ${fmtDateTime(roster.read_at)} : ${fmtInt(roster.total)} ${roster.total > 1 ? "membres" : "membre"}.` : "La liste officielle n'a encore jamais été relue : aucun contrôle automatique pour l'instant."} Cette liste est publique : y figurer ne prouve pas qu'on est ce membre. Vérifiez sur Discord.
      </p>
      <Problem message={list.error ?? action.error} onRetry={() => void list.reload()} />
      {action.done && <Success message={action.done} />}
      {list.rows === null ? (
        !list.error && <Loading />
      ) : list.rows.length === 0 ? (
        <Empty>Aucune demande en attente.</Empty>
      ) : (
        <ul class="mt-3 grid gap-3">
          {list.rows.map((r) => (
            <li key={r.id} class="card p-4" data-testid="request-row">
              <p class="font-semibold">
                {r.discord_name ?? r.name} <span class="text-sm font-normal text-muted">({r.name})</span>
              </p>
              <p class={r.in_roster ? "conq-success" : "conq-problem"} data-testid="request-roster">
                {r.in_roster ? `Dans la liste${r.roster_username ? ` : ${r.roster_username}` : ", membre sans pseudo public"}` : `Absent de la liste${r.claimed_text ? ` : a indiqué « ${r.claimed_text} »` : ""}`}
              </p>
              {(r.game_role === "leader" || r.game_role === "officer") && (
                <p class="mt-1 text-sm" data-testid="request-game-role">
                  {r.game_role === "leader" ? "Chef" : "Officier"} dans le jeu, d'après la liste publique. Ce rang ne donne aucun droit ici : à vous de le nommer après vérification.
                </p>
              )}
              {r.note && <p class="mt-1 text-sm">« {r.note} »</p>}
              <p class="tnum mt-1 text-xs text-muted">
                Demandé le {fmtDateTime(r.created_at)}
                {r.discord_id ? ` · Discord : ${r.discord_id}` : ""}
              </p>
              <label class="mt-3 block text-sm font-semibold" for={`reason-${r.id}`}>
                Raison (facultative)
              </label>
              <input id={`reason-${r.id}`} class="field mt-1" maxLength={300} value={reasons[r.id] ?? ""} onInput={(e) => setReasons({ ...reasons, [r.id]: e.currentTarget.value })} />
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary !min-h-10 !py-1.5" disabled={action.busy} onClick={() => void action.run(() => call("review_membership", { p_request: r.id, p_approve: true, p_reason: reasons[r.id] || null }), "Membre validé.")}>
                  Valider
                </button>
                <button type="button" class="btn btn-ghost !min-h-10 !py-1.5" disabled={action.busy} onClick={() => void action.run(() => call("review_membership", { p_request: r.id, p_approve: false, p_reason: reasons[r.id] || null }), "Demande refusée.")}>
                  Refuser
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Donations() {
  const pending = useList<DonationRow>("list_donations", { p_status: "pending" });
  const approved = useList<DonationRow>("list_donations", { p_status: "approved", p_limit: 30 });
  const reloadAll = async () => {
    await Promise.all([pending.reload(), approved.reload()]);
  };
  const action = useAction(reloadAll);
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const review = (d: DonationRow, approve: boolean) =>
    action.run(async () => {
      const res = await call<{ removed_path: string | null }>("review_donation", { p_donation: d.id, p_approve: approve, p_reason: reasons[d.id] || null });
      if (res.removed_path) await removeProof(res.removed_path);
    }, approve ? "Don validé." : "Don refusé.");

  return (
    <div data-testid="admin-donations">
      <p class="text-sm text-muted">Vérifiez chaque don dans le jeu : fiche de [GAL], onglet « Dons ». Seul un don validé compte, et personne ne valide les siens.</p>
      <Problem message={pending.error ?? action.error} onRetry={() => void reloadAll()} />
      {action.done && <Success message={action.done} />}
      <h3 class="mt-4 text-lg">À traiter</h3>
      {pending.rows === null ? (
        !pending.error && <Loading />
      ) : pending.rows.length === 0 ? (
        <Empty>Aucun don en attente.</Empty>
      ) : (
        <ul class="mt-2 grid gap-3">
          {pending.rows.map((d) => (
            <li key={d.id} class="card p-4" data-testid="pending-donation">
              <p class="font-semibold">
                {d.name} : <span class="tnum">{fmtInt(d.capsules)} capsules</span>
              </p>
              <p class="tnum text-sm text-muted">Don du {fmtDate(`${d.donated_on}T12:00:00Z`)}</p>
              {d.note && <p class="mt-1 text-sm">« {d.note} »</p>}
              {d.screenshot_path && (
                <button
                  type="button"
                  class="chip mt-2 !min-h-9"
                  onClick={() => {
                    // L'onglet s'ouvre dans le clic : ouvert plus tard, le navigateur le bloquerait.
                    const tab = window.open("about:blank", "_blank");
                    void proofUrl(d.screenshot_path!).then((url) => {
                      if (!tab) return;
                      if (url) {
                        tab.opener = null;
                        tab.location.href = url;
                      } else {
                        tab.close();
                      }
                    });
                  }}
                >
                  Voir la capture
                </button>
              )}
              {d.can_review ? (
                <>
                  <label class="mt-3 block text-sm font-semibold" for={`don-reason-${d.id}`}>
                    Raison (facultative)
                  </label>
                  <input id={`don-reason-${d.id}`} class="field mt-1" maxLength={300} value={reasons[d.id] ?? ""} onInput={(e) => setReasons({ ...reasons, [d.id]: e.currentTarget.value })} />
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="btn btn-primary !min-h-10 !py-1.5" disabled={action.busy} onClick={() => void review(d, true)}>
                      Valider
                    </button>
                    <button type="button" class="btn btn-ghost !min-h-10 !py-1.5" disabled={action.busy} onClick={() => void review(d, false)}>
                      Refuser
                    </button>
                  </div>
                </>
              ) : (
                <p class="mt-2 text-sm text-muted">C'est votre propre don : un autre officier doit le traiter.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <EnterDonation onDone={reloadAll} />

      <details class="mt-6">
        <summary class="cursor-pointer font-semibold">Corriger un don déjà validé</summary>
        {approved.rows === null ? (
          <Loading />
        ) : approved.rows.length === 0 ? (
          <Empty>Aucun don validé.</Empty>
        ) : (
          <ul class="mt-2 grid gap-2">
            {approved.rows.map((d) => (
              <li key={d.id} class="tnum flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <span>
                  {d.name} : {fmtInt(d.capsules)} capsules, {fmtDate(`${d.donated_on}T12:00:00Z`)}
                  {d.kind === "opening" ? " (total de départ)" : ""}
                </span>
                {d.can_review && (
                  <button
                    type="button"
                    class="chip !min-h-9"
                    disabled={action.busy}
                    onClick={() => {
                      const reason = window.prompt("Raison de l'annulation ?");
                      if (reason) void action.run(() => call("cancel_donation", { p_donation: d.id, p_reason: reason }), "Don annulé.");
                    }}
                  >
                    Annuler ce don
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function EnterDonation({ onDone }: { onDone: () => Promise<void> }) {
  const members = useList<MemberRow>("list_members", { p_limit: 500 });
  const [user, setUser] = useState("");
  const [capsules, setCapsules] = useState("");
  const [day, setDay] = useState(today());
  const [opening, setOpening] = useState(false);
  const [note, setNote] = useState("");
  const action = useAction(onDone);
  const eligible = (members.rows ?? []).filter((m) => m.status === "validated");

  return (
    <details class="mt-6" data-testid="enter-donation">
      <summary class="cursor-pointer font-semibold">Saisir un don ou un total de départ</summary>
      <form
        class="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            () => call("enter_donation", { p_request_id: newRequestId(), p_user: user, p_capsules: Number(capsules), p_donated_on: day, p_kind: opening ? "opening" : "donation", p_note: note || null }),
            "Don enregistré.",
          );
        }}
      >
        <div>
          <label class="text-sm font-semibold" for="enter-user">
            Membre
          </label>
          <select id="enter-user" class="field mt-1" required value={user} onChange={(e) => setUser(e.currentTarget.value)}>
            <option value="">Choisir…</option>
            {eligible.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label class="text-sm font-semibold" for="enter-capsules">
            Capsules
          </label>
          <input id="enter-capsules" class="field tnum mt-1" type="number" min={1} step={1} required value={capsules} onInput={(e) => setCapsules(e.currentTarget.value)} />
        </div>
        <div>
          <label class="text-sm font-semibold" for="enter-day">
            Date
          </label>
          <input id="enter-day" class="field tnum mt-1" type="date" required max={today()} value={day} onInput={(e) => setDay(e.currentTarget.value)} />
        </div>
        <div>
          <label class="text-sm font-semibold" for="enter-note">
            Note (facultative)
          </label>
          <input id="enter-note" class="field mt-1" maxLength={300} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        <label class="flex items-start gap-3 sm:col-span-2">
          <input type="checkbox" class="mt-1 size-5" checked={opening} onChange={(e) => setOpening(e.currentTarget.checked)} />
          <span class="text-sm">Total de départ, recopié de « Top donateurs » pour les dons d'avant l'ouverture du site. Il compte au total, pas dans la saison.</span>
        </label>
        <div class="sm:col-span-2">
          <button type="submit" class="btn btn-primary !min-h-10 !py-1.5" disabled={action.busy || !user || !capsules}>
            Enregistrer
          </button>
        </div>
        <div class="sm:col-span-2">
          <Problem message={action.error} />
          {action.done && <Success message={action.done} />}
        </div>
      </form>
    </details>
  );
}

function Members({ me }: { me: Me }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const list = useList<MemberRow>("list_members", { p_search: query || null, p_limit: 200 });
  const action = useAction(list.reload);
  const rank = me.rank ?? 0;
  const myRole = me.role ?? "member";
  const assignable: Role[] = rank >= 4 ? ["member", "officer", "admin"] : ["member", "officer"];

  return (
    <div data-testid="admin-members">
      <form
        class="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <div class="min-w-48 flex-1">
          <label class="text-sm font-semibold" for="member-search">
            Rechercher un membre
          </label>
          <input id="member-search" class="field mt-1" type="search" value={search} onInput={(e) => setSearch(e.currentTarget.value)} />
        </div>
        <button type="submit" class="btn btn-secondary !min-h-11">
          Chercher
        </button>
      </form>
      <Problem message={list.error ?? action.error} onRetry={() => void list.reload()} />
      {action.done && <Success message={action.done} />}
      {list.rows === null ? (
        !list.error && <Loading />
      ) : list.rows.length === 0 ? (
        <Empty>Aucun compte trouvé.</Empty>
      ) : (
        <div class="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Membres">
          <table class="data-table w-full">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Discord</th>
                <th scope="col">Statut</th>
                <th scope="col">Liste</th>
                <th scope="col" class="num">
                  Capsules
                </th>
                <th scope="col">Rôle</th>
                {rank >= 3 && <th scope="col">Action</th>}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((m) => {
                const editable = rank >= 3 && m.status === "validated" && m.role !== "founder" && (rank >= 4 || m.role !== "admin") && m.user_id !== undefined;
                return (
                  <tr key={m.user_id} data-testid="member-row">
                    <td class="font-semibold">{m.name}</td>
                    <td>{m.discord_name ?? "—"}</td>
                    <td>
                      {STATUS_LABELS[m.status]}
                      {m.status_reason ? ` : ${m.status_reason}` : ""}
                    </td>
                    <td>{m.linked ? (m.in_roster ? "Oui" : <span class="text-warn">Plus dans la liste</span>) : "—"}</td>
                    <td class="num tnum">{fmtInt(m.capsules)}</td>
                    <td>
                      {editable ? (
                        <select
                          aria-label={`Rôle de ${m.name}`}
                          class="field !min-h-9 !py-1"
                          value={m.role}
                          disabled={action.busy}
                          onChange={(e) => {
                            const role = e.currentTarget.value;
                            void action.run(() => call("set_member_role", { p_user: m.user_id, p_role: role }), `Rôle de ${m.name} modifié.`);
                          }}
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABELS[m.role]
                      )}
                    </td>
                    {rank >= 3 && (
                      <td>
                        {m.status === "validated" && m.role !== "founder" && (rank >= 4 || m.role !== "admin") && (
                          <button
                            type="button"
                            class="chip !min-h-9"
                            disabled={action.busy}
                            onClick={() => {
                              const reason = window.prompt(`Pourquoi suspendre ${m.name} ?`);
                              if (reason) void action.run(() => call("suspend_member", { p_user: m.user_id, p_reason: reason }), `${m.name} est suspendu.`);
                            }}
                          >
                            Suspendre
                          </button>
                        )}
                        {m.status === "suspended" && (
                          <button type="button" class="chip !min-h-9" disabled={action.busy} onClick={() => void action.run(() => call("reinstate_member", { p_user: m.user_id }), `${m.name} est rétabli.`)}>
                            Rétablir
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="mt-2 text-xs text-muted">Vous êtes {ROLE_LABELS[myRole]}. Le serveur revérifie chaque changement.</p>
    </div>
  );
}

function Moderation() {
  const excluded = useList<ExcludedRow>("list_excluded_players");
  const action = useAction(excluded.reload);
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div data-testid="admin-moderation">
      <p class="text-sm text-muted">Retirer un joueur de la saison en cours libère ses territoires. Il peut revenir s'il est rétabli, en choisissant un nouveau départ. Son numéro est indiqué dans l'onglet Membres.</p>
      <form
        class="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(() => call("exclude_player", { p_number: Number(number), p_reason: reason }), "Joueur retiré de la saison.");
        }}
      >
        <div>
          <label class="text-sm font-semibold" for="exclude-number">
            Numéro du joueur
          </label>
          <input id="exclude-number" class="field tnum mt-1" type="number" min={1} step={1} required value={number} onInput={(e) => setNumber(e.currentTarget.value)} />
        </div>
        <div>
          <label class="text-sm font-semibold" for="exclude-reason">
            Raison
          </label>
          <input id="exclude-reason" class="field mt-1" required maxLength={300} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
        </div>
        <button type="submit" class="btn btn-primary !min-h-11" disabled={action.busy}>
          Retirer
        </button>
      </form>
      <Problem message={excluded.error ?? action.error} />
      {action.done && <Success message={action.done} />}
      <h3 class="mt-5 text-lg">Joueurs retirés</h3>
      {excluded.rows === null ? (
        !excluded.error && <Loading />
      ) : excluded.rows.length === 0 ? (
        <Empty>Aucun joueur retiré de la saison en cours.</Empty>
      ) : (
        <ul class="mt-2 grid gap-2">
          {excluded.rows.map((p) => (
            <li key={p.number} class="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
              <span>
                {p.name} (n° {p.number}) : {p.excluded_reason ?? "sans raison"}
              </span>
              <button type="button" class="chip !min-h-9" disabled={action.busy} onClick={() => void action.run(() => call("reinstate_player", { p_number: p.number }), `${p.name} peut revenir.`)}>
                Rétablir
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfigEditor({ value, onChange }: { value: ConquestConfig; onChange: (c: ConquestConfig) => void }) {
  const fields = useMemo(() => flattenConfig(value), [value]);
  const set = (path: string, v: ConfigValue) => onChange(withValue(value, path, v));
  return (
    <div class="grid gap-3 sm:grid-cols-2" data-testid="config-editor">
      {fields.map(([path, current]) => {
        const info = CONFIG_LABELS[path];
        const id = `config-${path}`;
        return (
          <div key={path}>
            {typeof current === "boolean" ? (
              <label class="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" class="size-5" checked={current} onChange={(e) => set(path, e.currentTarget.checked)} />
                {info?.label ?? path}
              </label>
            ) : (
              <>
                <label class="text-sm font-semibold" for={id}>
                  {info?.label ?? path}
                </label>
                <input id={id} class="field tnum mt-1" type="number" step="any" value={current} onInput={(e) => set(path, Number(e.currentTarget.value))} />
              </>
            )}
            {info?.hint && <p class="mt-1 text-xs text-muted">{info.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

function SeasonCard({ season, action }: { season: SeasonRow; action: ReturnType<typeof useAction> }) {
  const [config, setConfig] = useState(season.config);
  const [war, setWar] = useState("");
  const warIso = war ? new Date(war).toISOString() : null;
  return (
    <li class="card p-4" data-testid="season-row">
      <p class="font-semibold">
        {season.name} <span class="text-sm font-normal text-muted">· {SEASON_LABELS[season.status]}</span>
      </p>
      <p class="tnum text-xs text-muted">
        {season.started_at ? `Lancée le ${fmtDateTime(season.started_at)}. ` : ""}
        {season.war_starts_at ? `Guerre prévue le ${fmtDateTime(season.war_starts_at)}. ` : ""}
        {season.closed_at ? `Terminée le ${fmtDateTime(season.closed_at)}.` : ""}
      </p>
      {season.status !== "closed" && (
        <>
          <div class="mt-3">
            <label class="text-sm font-semibold" for={`war-${season.id}`}>
              Date de début de la guerre (facultative)
            </label>
            <input id={`war-${season.id}`} class="field tnum mt-1" type="datetime-local" value={war} onInput={(e) => setWar(e.currentTarget.value)} />
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            {season.status === "draft" && (
              <button type="button" class="btn btn-primary !min-h-10 !py-1.5" disabled={action.busy} data-testid="start-season" onClick={() => void action.run(() => call("start_season", { p_season: season.id, p_war_starts_at: warIso }), "Saison lancée.")}>
                Lancer la saison
              </button>
            )}
            {season.status === "expansion" && (
              <>
                <button type="button" class="btn btn-secondary !min-h-10 !py-1.5" disabled={action.busy || !warIso} onClick={() => void action.run(() => call("set_war_date", { p_season: season.id, p_at: warIso }), "Date enregistrée.")}>
                  Fixer cette date
                </button>
                <button
                  type="button"
                  class="btn btn-secondary !min-h-10 !py-1.5"
                  disabled={action.busy}
                  data-testid="war-now"
                  onClick={() => {
                    if (window.confirm("Déclencher la guerre maintenant ?")) void action.run(() => call("set_war_date", { p_season: season.id, p_at: new Date().toISOString() }), "La guerre commence.");
                  }}
                >
                  Déclencher la guerre maintenant
                </button>
              </>
            )}
            {(season.status === "expansion" || season.status === "war") && (
              <button
                type="button"
                class="btn btn-ghost !min-h-10 !py-1.5"
                disabled={action.busy}
                data-testid="close-season"
                onClick={() => {
                  if (window.confirm("Clôturer la saison ? Le classement et la carte seront figés.")) void action.run(() => call("close_season", { p_season: season.id }), "Saison clôturée.");
                }}
              >
                Clôturer la saison
              </button>
            )}
          </div>
          <details class="mt-4">
            <summary class="cursor-pointer font-semibold">Réglages de cette saison</summary>
            <div class="mt-3">
              <ConfigEditor value={config} onChange={setConfig} />
              <button type="button" class="btn btn-primary mt-3 !min-h-10 !py-1.5" disabled={action.busy} onClick={() => void action.run(() => call("update_season_config", { p_season: season.id, p_config: config }), "Réglages enregistrés. L'ancien réglage reste au journal.")}>
                Enregistrer les réglages
              </button>
            </div>
          </details>
        </>
      )}
    </li>
  );
}

function Seasons() {
  const list = useList<SeasonRow>("list_seasons");
  const action = useAction(list.reload);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<ConquestConfig>(DEFAULT_CONFIG);
  const open = (list.rows ?? []).some((s) => s.status !== "closed");

  return (
    <div data-testid="admin-seasons">
      <Problem message={list.error ?? action.error} onRetry={() => void list.reload()} />
      {action.done && <Success message={action.done} />}
      {!open && list.rows !== null && (
        <form
          class="card mt-3 p-4"
          data-testid="create-season"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(() => call("create_season", { p_name: name, p_config: config }), "Saison créée : elle attend d'être lancée.");
          }}
        >
          <h3 class="text-lg">Nouvelle saison</h3>
          <label class="mt-3 block text-sm font-semibold" for="season-name">
            Nom
          </label>
          <input id="season-name" class="field mt-1" required maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <details class="mt-3">
            <summary class="cursor-pointer font-semibold">Réglages</summary>
            <div class="mt-3">
              <ConfigEditor value={config} onChange={setConfig} />
            </div>
          </details>
          <button type="submit" class="btn btn-primary mt-3 !min-h-10 !py-1.5" disabled={action.busy || name.trim() === ""}>
            Créer la saison
          </button>
        </form>
      )}
      {list.rows === null ? (
        !list.error && <Loading />
      ) : list.rows.length === 0 ? (
        <Empty>Aucune saison pour l'instant.</Empty>
      ) : (
        <ul class="mt-3 grid gap-3">
          {list.rows.map((s) => (
            <SeasonCard key={`${s.id}-${s.status}`} season={s} action={action} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Log() {
  const list = useList<LogRow>("list_admin_log", { p_limit: 200 });
  return (
    <div data-testid="admin-log">
      <Problem message={list.error} onRetry={() => void list.reload()} />
      {list.rows === null ? (
        !list.error && <Loading />
      ) : list.rows.length === 0 ? (
        <Empty>Le journal est vide.</Empty>
      ) : (
        <div class="overflow-x-auto" tabIndex={0} role="region" aria-label="Journal d'administration">
          <table class="data-table w-full">
            <thead>
              <tr>
                <th scope="col">Quand</th>
                <th scope="col">Qui</th>
                <th scope="col">Quoi</th>
                <th scope="col">Sur qui</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((l) => (
                <tr key={l.id} data-testid="log-row">
                  <td class="tnum whitespace-nowrap">{fmtDateTime(l.at)}</td>
                  <td>{l.actor ?? "Compte supprimé"}</td>
                  <td>{l.action}</td>
                  <td>{l.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminApp() {
  const { me, failed, refresh } = useMe();
  const [tab, setTab] = useState<Tab>("requests");

  if (me === null) return <Loading label="Lecture de votre compte…" />;
  if (failed) return <Problem message="Votre compte n'a pas pu être lu pour l'instant." onRetry={() => void refresh()} />;
  if (!me.signed_in) {
    return (
      <section class="card p-6" data-testid="admin-signed-out">
        <p class="mb-4">Cet espace est réservé aux officiers et aux admins du clan.</p>
        <DiscordButton returnPath="/admin" />
      </section>
    );
  }
  const rank = me.rank ?? 0;
  if (rank < 2) {
    return (
      <p class="card p-6" data-testid="admin-denied">
        Cet espace est réservé aux officiers et aux admins du clan. <a href={`${basePath()}/compte`}>Voir mon compte</a>
      </p>
    );
  }

  const tabs = TABS.filter((t) => rank >= t.rank);
  return (
    <div data-testid="admin">
      <div class="flex flex-wrap gap-2" role="tablist" aria-label="Sections de l'administration">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" class="chip" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div class="mt-5" role="tabpanel">
        {tab === "requests" && <Requests />}
        {tab === "donations" && <Donations />}
        {tab === "members" && <Members me={me} />}
        {tab === "moderation" && <Moderation />}
        {tab === "seasons" && <Seasons />}
        {tab === "log" && <Log />}
      </div>
    </div>
  );
}
