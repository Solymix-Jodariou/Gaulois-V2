import { useEffect, useState } from "preact/hooks";
import { basePath, call } from "../../lib/compte/api";
import { toLocalInput } from "../../lib/compte/news";
import { ROLE_LABELS, type MemberRow, type Role } from "../../lib/compte/types";
import { fmtDate, fmtDateTime, fmtInt } from "../../lib/format";
import { DiscordButton, Loading, Problem, Success, messageOf, useMe } from "./common";

interface NewsRow {
  id: number;
  title: string;
  url: string | null;
  author: string | null;
  editable: boolean;
}
interface AnnouncementRow extends NewsRow {
  body: string;
  created_at: string;
}
interface EventRow extends NewsRow {
  description: string | null;
  starts_at: string;
}
interface Overview {
  pending_requests: number;
  members: number;
  officers: number;
  suspended: number;
  roster: { total: number; read_at: string } | null;
  announcements: AnnouncementRow[];
  events: EventRow[];
}

function Tile({ label, value, href, alert = false }: { label: string; value: number; href: string; alert?: boolean }) {
  return (
    <a href={href} class="card block p-4 hover:border-white" data-testid="direction-tile">
      <span class="text-sm font-semibold text-muted">{label}</span>
      <span class={`tnum mt-1 block font-display text-3xl font-extrabold ${alert ? "text-warn" : ""}`}>{fmtInt(value)}</span>
    </a>
  );
}

/** Une suppression ne part qu'au second clic : le texte, lui, ne se récupère pas. */
function DeleteButton({ busy, onConfirm, label }: { busy: boolean; onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      class="btn btn-ghost !min-h-10 !py-1.5 !text-sm"
      disabled={busy}
      aria-label={armed ? `Confirmer la suppression de « ${label} »` : `Supprimer « ${label} »`}
      onClick={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? "Confirmer la suppression" : "Supprimer"}
    </button>
  );
}

/** Exécute une action : `true` si le serveur l'accepte, sinon son refus s'affiche. */
function useRun(after: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(success);
      await after();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

function Announcements({ rows, reload }: { rows: AnnouncementRow[]; reload: () => Promise<void> }) {
  const empty = { id: null as number | null, title: "", body: "", url: "" };
  const [form, setForm] = useState(empty);
  const { busy, error, done, run } = useRun(reload);

  const save = async () => {
    const ok = await run(() => call("save_announcement", { p_id: form.id, p_title: form.title, p_body: form.body, p_url: form.url || null }), form.id ? "Annonce modifiée." : "Annonce publiée : elle est visible sur l'accueil.");
    if (ok) setForm(empty);
  };

  return (
    <section class="card p-5" aria-labelledby="ann-title" data-testid="direction-announcements">
      <h2 id="ann-title" class="text-xl">
        Annonces
      </h2>
      <form
        class="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label for="ann-t" class="text-sm font-semibold">
            Titre
          </label>
          <input id="ann-t" class="field mt-1" required maxLength={120} value={form.title} onInput={(e) => setForm({ ...form, title: e.currentTarget.value })} />
        </div>
        <div>
          <label for="ann-b" class="text-sm font-semibold">
            Texte
          </label>
          <textarea id="ann-b" class="field mt-1" required rows={4} maxLength={2000} value={form.body} onInput={(e) => setForm({ ...form, body: e.currentTarget.value })} />
        </div>
        <div>
          <label for="ann-u" class="text-sm font-semibold">
            Lien en https (facultatif)
          </label>
          <input id="ann-u" class="field mt-1" type="url" maxLength={500} value={form.url} onInput={(e) => setForm({ ...form, url: e.currentTarget.value })} />
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {form.id ? "Enregistrer" : "Publier l'annonce"}
          </button>
          {form.id && (
            <button type="button" class="btn btn-ghost" onClick={() => setForm(empty)}>
              Annuler
            </button>
          )}
        </div>
      </form>
      <Problem message={error} />
      {done && <Success message={done} />}
      {rows.length > 0 && (
        <ul class="mt-5 grid gap-3">
          {rows.map((a) => (
            <li key={a.id} class="border-t border-line pt-3" data-testid="direction-announcement">
              <p class="font-semibold">{a.title}</p>
              <p class="tnum text-xs text-muted">
                {fmtDate(a.created_at)}
                {a.author ? ` · ${a.author}` : ""}
              </p>
              {a.editable && (
                <div class="mt-2 flex flex-wrap gap-2">
                  <button type="button" class="btn btn-ghost !min-h-10 !py-1.5 !text-sm" disabled={busy} aria-label={`Modifier « ${a.title} »`} onClick={() => setForm({ id: a.id, title: a.title, body: a.body, url: a.url ?? "" })}>
                    Modifier
                  </button>
                  <DeleteButton busy={busy} label={a.title} onConfirm={() => void run(() => call("delete_announcement", { p_id: a.id }), "Annonce supprimée.")} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Events({ rows, reload }: { rows: EventRow[]; reload: () => Promise<void> }) {
  const empty = { id: null as number | null, title: "", description: "", url: "", start: "" };
  const [form, setForm] = useState(empty);
  const { busy, error, done, run } = useRun(reload);

  const save = async () => {
    const ok = await run(
      () => call("save_event", { p_id: form.id, p_title: form.title, p_description: form.description || null, p_url: form.url || null, p_starts_at: form.start ? new Date(form.start).toISOString() : null }),
      form.id ? "Événement modifié." : "Événement publié : il est visible sur l'accueil.",
    );
    if (ok) setForm(empty);
  };

  return (
    <section class="card p-5" aria-labelledby="evt-title" data-testid="direction-events">
      <h2 id="evt-title" class="text-xl">
        Événements
      </h2>
      <form
        class="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label for="evt-t" class="text-sm font-semibold">
            Nom de l'événement
          </label>
          <input id="evt-t" class="field mt-1" required maxLength={120} value={form.title} onInput={(e) => setForm({ ...form, title: e.currentTarget.value })} />
        </div>
        <div>
          <label for="evt-s" class="text-sm font-semibold">
            Date et heure
          </label>
          <input id="evt-s" class="field mt-1" type="datetime-local" required value={form.start} onInput={(e) => setForm({ ...form, start: e.currentTarget.value })} />
        </div>
        <div>
          <label for="evt-d" class="text-sm font-semibold">
            Description (facultative)
          </label>
          <textarea id="evt-d" class="field mt-1" rows={3} maxLength={2000} value={form.description} onInput={(e) => setForm({ ...form, description: e.currentTarget.value })} />
        </div>
        <div>
          <label for="evt-u" class="text-sm font-semibold">
            Lien en https (facultatif)
          </label>
          <input id="evt-u" class="field mt-1" type="url" maxLength={500} value={form.url} onInput={(e) => setForm({ ...form, url: e.currentTarget.value })} />
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {form.id ? "Enregistrer" : "Publier l'événement"}
          </button>
          {form.id && (
            <button type="button" class="btn btn-ghost" onClick={() => setForm(empty)}>
              Annuler
            </button>
          )}
        </div>
      </form>
      <Problem message={error} />
      {done && <Success message={done} />}
      {rows.length > 0 && (
        <ul class="mt-5 grid gap-3">
          {rows.map((ev) => (
            <li key={ev.id} class="border-t border-line pt-3" data-testid="direction-event">
              <p class="font-semibold">{ev.title}</p>
              <p class="tnum text-xs text-muted">
                {fmtDateTime(ev.starts_at)}
                {ev.author ? ` · ${ev.author}` : ""}
              </p>
              {ev.editable && (
                <div class="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost !min-h-10 !py-1.5 !text-sm"
                    disabled={busy}
                    aria-label={`Modifier « ${ev.title} »`}
                    onClick={() => setForm({ id: ev.id, title: ev.title, description: ev.description ?? "", url: ev.url ?? "", start: toLocalInput(ev.starts_at) })}
                  >
                    Modifier
                  </button>
                  <DeleteButton busy={busy} label={ev.title} onConfirm={() => void run(() => call("delete_event", { p_id: ev.id }), "Événement supprimé.")} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Le fondateur transmet son rôle. Il faut retaper le nom : on ne revient pas seul en arrière. */
function FounderTransfer({ onDone }: { onDone: () => Promise<void> }) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, done, run } = useRun(onDone);

  useEffect(() => {
    call<{ rows: MemberRow[] }>("list_members", { p_limit: 500 })
      .then((data) => setMembers(data.rows.filter((m) => m.status === "validated" && m.role !== "founder")))
      .catch(() => setMembers([]));
  }, []);

  const chosen = members?.find((m) => m.user_id === target);

  return (
    <section class="card p-5" aria-labelledby="founder-title" data-testid="direction-founder">
      <h2 id="founder-title" class="text-xl">
        Transmettre le rôle de fondateur
      </h2>
      <p class="mt-2 text-sm text-muted">Vous devenez admin, et seul le nouveau fondateur pourra vous rendre ce rôle. Le clan garde toujours un fondateur : c'est aussi ce qui vous permet ensuite de supprimer votre compte.</p>
      {members === null ? (
        <Loading />
      ) : members.length === 0 ? (
        <p class="mt-3 text-muted">Aucun autre membre validé pour l'instant.</p>
      ) : (
        <form
          class="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => call("transfer_founder", { p_user: target }), "Rôle transmis.");
          }}
        >
          <div>
            <label for="heir" class="text-sm font-semibold">
              Nouveau fondateur
            </label>
            <select
              id="heir"
              class="field mt-1"
              required
              value={target}
              onChange={(e) => {
                setTarget(e.currentTarget.value);
                setTyped("");
              }}
            >
              <option value="">Choisir un membre</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name} ({ROLE_LABELS[m.role as Role]})
                </option>
              ))}
            </select>
          </div>
          {chosen && (
            <div>
              <label for="heir-confirm" class="text-sm font-semibold">
                Retapez « {chosen.name} » pour confirmer
              </label>
              <input id="heir-confirm" class="field mt-1" autocomplete="off" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} />
            </div>
          )}
          <div>
            <button type="submit" class="btn btn-ghost" disabled={busy || !chosen || typed !== chosen.name}>
              Transmettre le rôle
            </button>
          </div>
        </form>
      )}
      <Problem message={error} />
      {done && <Success message={done} />}
    </section>
  );
}

export default function DirectionApp() {
  const { me, failed, refresh } = useMe();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rank = me?.rank ?? 0;
  const base = basePath();

  const load = async () => {
    try {
      setOverview(await call<Overview>("get_direction_overview"));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  useEffect(() => {
    if (rank >= 2) void load();
  }, [rank]);

  if (me === null) return <Loading />;
  if (failed) return <Problem message="Le service de connexion ne répond pas pour l'instant. Le reste du site continue de fonctionner." onRetry={() => void refresh()} />;
  if (!me.signed_in) {
    return (
      <section class="card max-w-xl p-5" data-testid="direction-signed-out">
        <p class="mb-4">Cet espace est réservé aux officiers et aux chefs du clan.</p>
        <DiscordButton returnPath="/direction" />
      </section>
    );
  }
  if (rank < 2) {
    return (
      <section class="card max-w-xl p-5" data-testid="direction-forbidden">
        <p>
          Cet espace est réservé aux officiers et aux chefs du clan. <a href={`${base}/compte`}>Voir mon compte</a>
        </p>
      </section>
    );
  }

  const admin = `${base}/admin`;
  return (
    <div class="grid gap-6" data-testid="direction">
      <p class="text-muted">
        Connecté en tant que <strong>{me.name}</strong>, {ROLE_LABELS[me.role as Role].toLowerCase()}. <a href={`${base}/compte`}>Mon compte</a>
      </p>
      <Problem message={error} onRetry={() => void load()} />
      {overview === null ? (
        !error && <Loading />
      ) : (
        <>
          <section aria-label="Ce qui attend une décision">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Demandes à traiter" value={overview.pending_requests} href={admin} alert={overview.pending_requests > 0} />
              <Tile label="Membres validés" value={overview.members} href={admin} />
              <Tile label="Encadrement" value={overview.officers} href={admin} />
              <Tile label="Suspendus" value={overview.suspended} href={admin} />
            </div>
            <p class="mt-3 text-sm text-muted">
              {overview.roster ? `Liste officielle relue le ${fmtDateTime(overview.roster.read_at)} : ${fmtInt(overview.roster.total)} ${overview.roster.total > 1 ? "membres" : "membre"}.` : "La liste officielle n'a encore jamais été relue."}{" "}
              <a href={admin}>Ouvrir l'administration</a> pour valider les membres, gérer les rôles et lire le journal.
            </p>
          </section>
          <div class="grid items-start gap-6 lg:grid-cols-2">
            <Announcements rows={overview.announcements} reload={load} />
            <Events rows={overview.events} reload={load} />
          </div>
          {me.role === "founder" && (
            <FounderTransfer
              onDone={async () => {
                await refresh();
                await load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
