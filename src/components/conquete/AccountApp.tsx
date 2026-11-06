import { useEffect, useState } from "preact/hooks";
import { PROOF_MAX_BYTES, PROOF_TYPES, basePath, call, newRequestId, signOut, uploadProof } from "../../lib/conquete/api";
import { ROLE_LABELS, type Donation, type DonationStatus, type Me } from "../../lib/conquete/types";
import { fmtDate, fmtInt } from "../../lib/format";
import { DiscordButton, Empty, Loading, Problem, Success, messageOf, useMe } from "./common";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

const DONATION_LABELS: Record<DonationStatus, string> = { pending: "En attente d'un officier", approved: "Validé", refused: "Refusé", cancelled: "Annulé", superseded: "Remplacé par la lecture de la liste du jeu" };

/** Lier son profil OpenFront et demander sa validation. */
function MembershipRequest({ me, onChange }: { me: Me; onChange: () => Promise<void> }) {
  const [claim, setClaim] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = me.request;
  const open = request?.status === "pending";

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("request_membership", { p_claim: claim, p_note: note || null });
      setClaim("");
      setNote("");
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await call("cancel_membership_request");
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <section class="card p-5" data-testid="request-pending">
        <h2 class="text-xl">Demande en attente</h2>
        <p class="mt-2">
          {request.in_roster ? (
            <>
              Votre profil{request.roster_username ? ` « ${request.roster_username} »` : ""} figure bien dans la liste des membres de GAL. Un officier doit encore confirmer que c'est bien vous, car cette liste est publique.
            </>
          ) : (
            <>Ce profil n'a pas été trouvé dans la liste des membres de GAL, relue une fois par jour. Un officier va vérifier. Si vous venez d'arriver, c'est normal.</>
          )}
        </p>
        <p class="mt-2 text-sm text-muted">Envoyée le {fmtDate(request.created_at)}. Tant qu'elle n'est pas validée, vous ne voyez que ce statut et ce qui est public.</p>
        <button type="button" class="btn btn-ghost mt-4 !min-h-10 !py-1.5 !text-sm" disabled={busy} onClick={() => void cancel()}>
          Annuler ma demande
        </button>
        <Problem message={error} />
      </section>
    );
  }

  return (
    <section class="card p-5" data-testid="request-form">
      <h2 class="text-xl">Lier mon profil OpenFront</h2>
      <p class="mt-2 text-muted">Votre compte Discord ne prouve pas que vous êtes membre de GAL. Indiquez votre pseudo OpenFront, ou votre identifiant public si vous n'avez pas de pseudo : un officier confirmera ensuite que c'est bien vous.</p>
      {request?.status === "refused" && (
        <p class="conq-problem mt-3" data-testid="request-refused">
          Votre dernière demande a été refusée{request.reason ? ` : ${request.reason}` : "."}
        </p>
      )}
      <form
        class="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div>
          <label for="claim" class="text-sm font-semibold">
            Pseudo OpenFront ou identifiant public
          </label>
          <input id="claim" class="field mt-1" required maxLength={64} autocomplete="off" value={claim} onInput={(e) => setClaim(e.currentTarget.value)} />
        </div>
        <div>
          <label for="note" class="text-sm font-semibold">
            Un mot pour l'officier (facultatif)
          </label>
          <input id="note" class="field mt-1" maxLength={300} placeholder="Votre pseudo sur le Discord du clan, par exemple" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        <div>
          <button type="submit" class="btn btn-primary" disabled={busy || claim.trim() === ""}>
            Demander ma validation
          </button>
        </div>
      </form>
      <Problem message={error} />
    </section>
  );
}

function DeclareDonation({ userId, onDone }: { userId: string; onDone: () => Promise<void> }) {
  const [capsules, setCapsules] = useState("");
  const [day, setDay] = useState(today());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (file && !PROOF_TYPES.includes(file.type)) throw new Error("La capture doit être une image PNG, JPEG ou WebP.");
      if (file && file.size > PROOF_MAX_BYTES) throw new Error("La capture ne doit pas dépasser 2 Mo.");
      const path = file ? await uploadProof(userId, file) : null;
      await call("declare_donation", {
        p_request_id: newRequestId(),
        p_capsules: Number(capsules),
        p_donated_on: day,
        p_screenshot_path: path,
        p_note: note || null,
      });
      setCapsules("");
      setNote("");
      setFile(null);
      setDone("Déclaration envoyée. Elle comptera une fois validée par un officier, et vos troupes arriveront à ce moment-là.");
      await onDone();
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="mt-4 grid gap-3 sm:grid-cols-2"
      data-testid="declare-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div>
        <label for="capsules" class="text-sm font-semibold">
          Capsules données
        </label>
        <input id="capsules" class="field tnum mt-1" type="number" inputMode="numeric" min={1} step={1} required value={capsules} onInput={(e) => setCapsules(e.currentTarget.value)} />
      </div>
      <div>
        <label for="donated-on" class="text-sm font-semibold">
          Date du don
        </label>
        <input id="donated-on" class="field tnum mt-1" type="date" required max={today()} value={day} onInput={(e) => setDay(e.currentTarget.value)} />
      </div>
      <div>
        <label for="proof" class="text-sm font-semibold">
          Capture (facultative, 2 Mo au plus)
        </label>
        <input id="proof" class="field mt-1" type="file" accept={PROOF_TYPES.join(",")} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
        <p class="mt-1 text-xs text-muted">Visible par vous et par les officiers, effacée après leur décision.</p>
      </div>
      <div>
        <label for="donation-note" class="text-sm font-semibold">
          Un mot (facultatif)
        </label>
        <input id="donation-note" class="field mt-1" maxLength={300} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="sm:col-span-2">
        <button type="submit" class="btn btn-primary" disabled={busy || capsules === ""}>
          {busy ? "Envoi…" : "Déclarer ce don"}
        </button>
      </div>
      <div class="sm:col-span-2">
        <Problem message={error} />
        {done && <Success message={done} />}
      </div>
    </form>
  );
}

function MyDonations({ me, userId, onChange }: { me: Me; userId: string; onChange: () => Promise<void> }) {
  const [rows, setRows] = useState<Donation[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(me.anonymous ?? true);

  const load = async () => {
    try {
      const mine = await call<{ rows: Donation[]; synced: boolean; troops_per_capsule: number | null }>("get_my_donations");
      setRows(mine.rows);
      setSynced(mine.synced);
      setRate(mine.troops_per_capsule);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  useEffect(() => {
    void load();
    // Une seule lecture à l'ouverture : la déclaration relance `load` elle-même.
  }, []);

  const toggle = async (value: boolean) => {
    setAnonymous(value);
    try {
      await call("set_donation_anonymity", { p_anonymous: value });
      await onChange();
    } catch (e) {
      setAnonymous(!value);
      setError(messageOf(e));
    }
  };

  return (
    <section class="card p-5" data-testid="my-donations">
      <h2 class="text-xl">Mes dons de capsules</h2>
      <p class="tnum mt-2 text-4xl font-extrabold" data-testid="my-capsules">
        {fmtInt(me.capsules ?? 0)}
      </p>
      <p class="text-sm text-muted">
        capsules {synced ? "lues chez OpenFront" : "validées par un officier"}. Elles augmentent votre capacité de troupes dans la Conquête.
        {rate !== null && rate > 0 ? ` Pendant la saison, chaque capsule donnée vous apporte aussi ${fmtInt(rate)} troupes en renfort, dans la limite de votre capacité.` : ""}
      </p>

      <p class="mt-3 rounded-lg border border-line p-3 text-sm text-muted">
        <strong class="text-warn">Un don est permanent et non remboursable. Rien ne vous oblige à donner.</strong> Le don se fait dans le jeu, sur la fiche de [GAL]. {synced ? "Ici, il apparaît à la prochaine lecture de la liste du jeu." : "Ici, vous le déclarez seulement."} Seules les capsules comptent, jamais le Plutonium.
      </p>

      <label class="mt-4 flex items-start gap-3">
        <input type="checkbox" class="mt-1 size-5" checked={!anonymous} data-testid="show-name" onChange={(e) => void toggle(!e.currentTarget.checked)} />
        <span>
          <span class="font-semibold">Afficher mon nom dans le classement public des donneurs</span>
          <span class="block text-sm text-muted">Sans cela, vous y apparaissez comme « Anonyme ». Dans le jeu, ces dons ne sont visibles que des membres du clan.</span>
        </span>
      </label>

      {!synced && <DeclareDonation userId={userId} onDone={async () => { await load(); await onChange(); }} />}

      <h3 class="mt-6 text-lg">Historique</h3>
      <Problem message={error} onRetry={() => void load()} />
      {rows === null ? (
        !error && <Loading />
      ) : rows.length === 0 ? (
        <Empty>Aucun don déclaré pour l'instant.</Empty>
      ) : (
        <div class="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Historique de mes dons">
          <table class="data-table w-full">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" class="num">
                  Capsules
                </th>
                <th scope="col" class="num">
                  Troupes reçues
                </th>
                <th scope="col">État</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} data-testid="donation-row">
                  <td class="tnum">{fmtDate(`${d.donated_on}T12:00:00Z`)}</td>
                  <td class="num tnum">{fmtInt(d.capsules)}</td>
                  <td class="num tnum">{d.troops_granted > 0 ? `+${fmtInt(d.troops_granted)}` : "—"}</td>
                  <td>
                    {d.kind === "opening" ? "Total de départ, " : ""}
                    {DONATION_LABELS[d.status]}
                    {d.reason ? ` : ${d.reason}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeleteAccount({ founder }: { founder: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (founder) return null;
  return (
    <section class="mt-6" data-testid="delete-account">
      <h2 class="text-lg">Effacer mon compte</h2>
      <p class="mt-1 text-sm text-muted">Vos données, vos dons déclarés et votre place dans la saison sont supprimés, et vos territoires redeviennent libres. Cela ne touche pas à votre compte OpenFront ni à vos dons dans le jeu.</p>
      <button
        type="button"
        class="btn btn-ghost mt-3 !min-h-10 !py-1.5 !text-sm"
        onClick={() => {
          if (!window.confirm("Effacer définitivement votre compte sur ce site ?")) return;
          call("delete_my_account")
            .then(() => signOut())
            .then(() => {
              location.href = `${basePath()}/`;
            })
            .catch((e: unknown) => setError(messageOf(e)));
        }}
      >
        Effacer mon compte
      </button>
      <Problem message={error} />
    </section>
  );
}

export default function AccountApp() {
  const { me, failed, userId, refresh } = useMe();

  if (me === null) return <Loading label="Lecture de votre compte…" />;
  if (failed) return <Problem message="Votre compte n'a pas pu être lu pour l'instant. Réessayez dans un moment." onRetry={() => void refresh()} />;

  if (!me.signed_in) {
    return (
      <section class="card p-6" data-testid="signed-out">
        <h2 class="text-2xl">Pour jouer, connectez-vous</h2>
        <p class="mt-2 text-muted">La connexion passe par Discord. Le site ne reçoit jamais votre mot de passe. Un officier validera ensuite que vous êtes bien membre de GAL.</p>
        <div class="mt-4">
          <DiscordButton returnPath="/compte" />
        </div>
        <p class="mt-3 text-sm text-muted">
          Ce qui est conservé est décrit dans la <a href={`${basePath()}/confidentialite`}>page de confidentialité</a>. Sans compte, vous pouvez suivre <a href={`${basePath()}/conquete`}>la carte</a> et <a href={`${basePath()}/dons`}>le classement des donneurs</a>.
        </p>
      </section>
    );
  }

  return (
    <div class="grid gap-6" data-testid="account">
      <section class="card p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-display text-2xl font-extrabold" data-testid="account-name">
              {me.name}
            </p>
            <p class="text-sm text-muted">
              Connecté avec Discord{me.discord_name ? ` : ${me.discord_name}` : ""}
              {me.openfront_username ? ` · OpenFront : ${me.openfront_username}` : ""}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost !min-h-10 !py-1.5 !text-sm"
            data-testid="sign-out"
            onClick={() => {
              void signOut().then(refresh);
            }}
          >
            Se déconnecter
          </button>
        </div>
        <p class="mt-3" data-testid="account-status">
          {me.status === "validated" && (
            <>
              <strong>Membre validé</strong> · Rôle : {ROLE_LABELS[me.role ?? "member"]}
            </>
          )}
          {me.status === "pending" && <strong>En attente de validation</strong>}
          {me.status === "suspended" && (
            <>
              <strong>Compte suspendu</strong>
              {me.status_reason ? ` : ${me.status_reason}` : ""}
            </>
          )}
        </p>
        {me.status === "validated" && (
          <div class="mt-4 flex flex-wrap gap-3">
            <a class="btn btn-primary" href={`${basePath()}/conquete`}>
              Aller à la Conquête
            </a>
            {(me.rank ?? 0) >= 2 && (
              <a class="btn btn-secondary" href={`${basePath()}/admin`}>
                Administration
              </a>
            )}
          </div>
        )}
      </section>

      {me.status === "pending" && <MembershipRequest me={me} onChange={refresh} />}
      {me.status === "validated" && userId && <MyDonations me={me} userId={userId} onChange={refresh} />}

      <DeleteAccount founder={me.role === "founder"} />
    </div>
  );
}
