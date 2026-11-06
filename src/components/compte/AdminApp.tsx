import { useEffect, useState } from "preact/hooks";
import { basePath, call } from "../../lib/compte/api";
import { ROLE_LABELS, type LogRow, type Me, type MemberRow, type RequestRow, type Role } from "../../lib/compte/types";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { DiscordButton, Empty, Loading, Problem, Success, messageOf, useMe } from "./common";

type Tab = "requests" | "members" | "log";

/** L'affichage suit le rôle, mais chaque fonction du serveur revérifie : masquer un onglet ne protège rien. */
const TABS: { id: Tab; label: string; rank: number }[] = [
  { id: "requests", label: "Demandes", rank: 2 },
  { id: "members", label: "Membres", rank: 2 },
  { id: "log", label: "Journal", rank: 3 },
];

const STATUS_LABELS = { pending: "En attente", validated: "Validé", suspended: "Suspendu" } as const;

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
              <p class={r.in_roster ? "form-success" : "form-problem"} data-testid="request-roster">
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
        {tab === "members" && <Members me={me} />}
        {tab === "log" && <Log />}
      </div>
    </div>
  );
}
