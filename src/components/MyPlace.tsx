import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { fmtInt, fmtPct } from "../lib/format";
import { gamesOf, placeOf, rateOf, suggestMembers } from "../lib/members";
import type { StoredMember, StoredMembers } from "../lib/schemas";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: StoredMembers };

const ordinal = (n: number) => `${n}${n === 1 ? "er" : "e"}`;
const nameOf = (m: StoredMember) => m.username ?? "un membre anonyme";

function Result({ members, member }: { members: readonly StoredMember[]; member: StoredMember }) {
  const place = placeOf(members, member);
  if (!place) {
    return (
      <p class="mt-4 font-semibold" data-testid="my-place-result">
        {member.username} : pas de données pour ce membre.
      </p>
    );
  }
  const games = gamesOf(member) ?? 0;
  if (games === 0) {
    return (
      <p class="mt-4 font-semibold" data-testid="my-place-result">
        {member.username} : aucune partie sous le tag pour l'instant. Une victoire avec le tag GAL, et vous entrez dans le classement.
      </p>
    );
  }
  const target = place.next?.team?.wins ?? place.wins;
  return (
    <div class="mt-4 grid gap-4 sm:grid-cols-2" data-testid="my-place-result">
      <div>
        <p class="truncate text-sm font-semibold text-muted">{member.username}</p>
        <p class="tnum font-display text-4xl font-extrabold">{ordinal(place.rank)}</p>
        <p class="tnum text-sm text-muted">sur {fmtInt(place.ranked)} membres, aux victoires sous le tag</p>
        <p class="tnum mt-2 text-sm">
          {fmtInt(place.wins)} victoires · {fmtInt(member.team?.losses ?? 0)} défaites · {fmtPct(rateOf(member))}
        </p>
      </div>
      <div>
        {place.next && place.missing !== null ? (
          <>
            <p class="font-semibold">Prochain à dépasser : {nameOf(place.next)}</p>
            <p class="tnum text-sm text-muted">
              Encore {fmtInt(place.missing)} {place.missing > 1 ? "victoires" : "victoire"} sous le tag.
            </p>
            <div class="meter mt-2" aria-hidden="true">
              <i style={{ "--v": `${target > 0 ? (place.wins / target) * 100 : 0}%` }}></i>
            </div>
          </>
        ) : (
          <p class="font-semibold">Personne devant : vous menez le clan aux victoires sous le tag.</p>
        )}
        {place.behind && place.lead !== null && (
          <p class="tnum mt-2 text-sm text-muted">
            Juste derrière : {nameOf(place.behind)}, à {fmtInt(place.lead)} {place.lead > 1 ? "victoires" : "victoire"}.
          </p>
        )}
      </div>
    </div>
  );
}

/** Chaque membre retrouve sa place à partir de son pseudo, avec les données déjà publiées sur la page Membres. */
export default function MyPlace({ src }: { src: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<StoredMember | null>(null);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Un pseudo tapé avant le démarrage du composant n'est pas perdu.
  useLayoutEffect(() => {
    if (input.current?.value) setQuery(input.current.value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: StoredMembers) => {
        if (!cancelled) setState({ status: "ready", data: json });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [src, attempt]);

  const members = state.status === "ready" ? state.data.members : [];
  const matches = useMemo(() => suggestMembers(members, query), [members, query]);
  // Un seul résultat, ou un pseudo exact : inutile de demander de choisir.
  const exact = matches.find((m) => m.username?.toLowerCase() === query.trim().toLowerCase());
  const chosen = picked ?? exact ?? (matches.length === 1 ? (matches[0] ?? null) : null);

  return (
    <div>
      <label for="my-place-name" class="text-sm font-semibold">
        Votre pseudo dans le jeu
      </label>
      <input
        id="my-place-name"
        ref={input}
        class="field mt-1"
        type="search"
        autocomplete="off"
        placeholder="Tapez votre pseudo"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setPicked(null);
        }}
      />
      {state.status === "error" && (
        <p class="mt-3 text-sm font-semibold text-warn" role="alert">
          La liste des membres n'a pas pu être chargée.{" "}
          <button type="button" class="underline" onClick={() => setAttempt((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}
      {query.trim() !== "" && state.status === "ready" && matches.length === 0 && (
        <p class="mt-3 text-sm text-muted" role="status">
          Aucun membre avec ce pseudo. Les membres sans pseudo public ne peuvent pas être cherchés.
        </p>
      )}
      {!chosen && matches.length > 1 && (
        <ul class="film-moments mt-3" aria-label="Pseudos trouvés">
          {matches.map((m) => (
            <li key={m.publicId ?? m.username}>
              <button type="button" class="chip" onClick={() => setPicked(m)}>
                {m.username}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && <Result members={members} member={chosen} />}
    </div>
  );
}
