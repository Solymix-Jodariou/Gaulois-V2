import { useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { call, newRequestId } from "../../lib/conquete/api";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { TERRAIN_LABELS, neutralCost, resolveAttack, troopsToWin } from "../../lib/conquete/rules";
import type { MapTerritory, Me, MyGame, Player, Season, TerritoryState } from "../../lib/conquete/types";
import { DiscordButton, Problem, Success, messageOf } from "./common";

type Mode = "start" | "expand" | "attack" | "reinforce";

interface Props {
  season: Season;
  territory: MapTerritory | null;
  state: TerritoryState | null;
  owner: Player | null;
  me: Me | null;
  mine: MyGame | null;
  myNumber: number | null;
  /** Mes territoires. */
  owned: ReadonlySet<number>;
  onDone: () => Promise<void>;
}

const troops = (n: number) => `${fmtInt(n)} ${n > 1 ? "troupes" : "troupe"}`;
const willHold = (n: number) => `${troops(n)} y ${n > 1 ? "tiendront" : "tiendra"} garnison`;
const holds = (n: number) => `${troops(n)} y ${n > 1 ? "tiennent" : "tient"} garnison`;

const ACTION_LABELS: Record<Mode, string> = {
  start: "Choisir comme territoire de départ",
  expand: "Conquérir ce territoire",
  attack: "Attaquer ce territoire",
  reinforce: "Renforcer ce territoire",
};

/** Ce que peut faire le joueur ici, ou pourquoi il ne le peut pas. */
function modeFor({ season, territory, state, me, mine, myNumber, owned }: Props): { mode: Mode | null; why: string | null } {
  if (!territory) return { mode: null, why: null };
  if (!me?.signed_in) return { mode: null, why: null };
  if (me.status !== "validated") return { mode: null, why: "Votre compte doit d'abord être validé par un officier." };
  if (mine?.excluded) return { mode: null, why: `Vous avez été retiré de cette saison${mine.excluded_reason ? ` : ${mine.excluded_reason}` : ""}.` };
  const hasTerritory = owned.size > 0;
  if (state?.owner === myNumber) return { mode: "reinforce", why: null };
  if (!hasTerritory) {
    if (state) return { mode: null, why: "Choisissez d'abord un territoire de départ libre." };
    return { mode: "start", why: null };
  }
  const adjacent = territory.neighbours.some((n) => owned.has(n));
  if (!adjacent) return { mode: null, why: "Ce territoire n'est pas voisin des vôtres." };
  if (!state) return { mode: "expand", why: null };
  if (season.phase !== "war") return { mode: null, why: "Il appartient à un autre membre : la guerre n'a pas encore commencé." };
  return { mode: "attack", why: null };
}

export default function ActionPanel(props: Props) {
  const { season, territory, state, owner, me, mine, onDone } = props;
  const { mode, why } = modeFor(props);
  const config = season.config;
  const reserve = mine?.in_game === false ? (mine.start_troops ?? 0) : (mine?.troops ?? 0);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cost = territory ? neutralCost(territory.terrain, config) : 0;
  const toWin = useMemo(() => (territory && state ? troopsToWin(state.garrison, territory.terrain, config) : 0), [territory, state, config]);

  // À chaque territoire, une proposition sensée : un cinquième de la réserve, comme l'attaque par défaut d'OpenFront.
  // Avant l'affichage, et non après : elle ne doit jamais écraser ce que le joueur vient de taper.
  useLayoutEffect(() => {
    if (mode === "expand") setAmount(Math.min(reserve, Math.max(cost + 500, Math.floor(reserve / 5))));
    else if (mode === "attack") setAmount(toWin <= reserve ? Math.max(toWin, Math.floor(reserve / 5)) : Math.floor(reserve / 5));
    else setAmount(Math.floor(reserve / 5));
    // Ne repropose qu'en changeant de territoire ou d'action, ou quand la réserve vient d'être lue.
  }, [territory?.id, mode, reserve === 0]);

  // Le résultat d'une action reste affiché : il ne s'efface qu'en changeant de territoire.
  useEffect(() => {
    setError(null);
    setDone(null);
  }, [territory?.id]);

  // Après une action, la réserve a baissé : l'envoi proposé ne doit pas la dépasser.
  useEffect(() => {
    if (amount > reserve) setAmount(Math.floor(reserve / 5));
  }, [reserve]);

  if (!territory) {
    return (
      <div class="conq-side-empty" data-testid="action-panel">
        <p class="font-semibold">Choisissez un territoire</p>
        <p class="mt-1 text-sm text-muted">Sur la carte ou dans la liste.</p>
      </div>
    );
  }

  const isProtected = state?.protected_until ? Date.parse(state.protected_until) > Date.now() : false;
  const attack = mode === "attack" && amount >= 1 ? resolveAttack(amount, state!.garrison, territory.terrain, config) : null;

  const send = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const args = { p_request_id: newRequestId(), p_territory: territory.id };
      if (mode === "start") {
        await call("choose_start", { ...args, p_garrison: amount });
        setDone(`Vous vous installez à ${territory.name}, avec ${troops(amount)}.`);
      } else if (mode === "expand") {
        const res = await call<{ garrison: number }>("expand", { ...args, p_troops: amount });
        setDone(`${territory.name} est à vous : ${holds(res.garrison)}.`);
      } else if (mode === "reinforce") {
        const res = await call<{ garrison: number }>("reinforce", { ...args, p_troops: amount });
        setDone(`${territory.name} compte maintenant ${troops(res.garrison)}.`);
      } else if (mode === "attack") {
        const res = await call<{ won: boolean; losses: number; garrison_after: number }>("attack", { ...args, p_troops: amount });
        setDone(
          res.won
            ? `Victoire ! ${territory.name} est à vous : ${holds(res.garrison_after)}.`
            : `L'attaque a échoué : la garnison de ${territory.name} tombe à ${fmtInt(res.garrison_after)}.`,
        );
      }
      await onDone();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const expansionsLeft = config.limits.expansionsPerDay - (mine?.expansions_today ?? 0);
  const attacksLeft = config.limits.attacksPerDay - (mine?.attacks_today ?? 0);
  const cooldown = mine?.cooldown_until && Date.parse(mine.cooldown_until) > Date.now() ? mine.cooldown_until : null;

  return (
    <div data-testid="action-panel">
      <h3 class="text-xl" data-testid="territory-name">
        {territory.name}
      </h3>
      <dl class="conq-facts tnum mt-3">
        <div>
          <dt>Terrain</dt>
          <dd>{TERRAIN_LABELS[territory.terrain]}</dd>
        </div>
        <div>
          <dt>Propriétaire</dt>
          <dd>{owner ? owner.name : state ? "Ancien membre" : "Terre libre"}</dd>
        </div>
        {state && (
          <div>
            <dt>Garnison</dt>
            <dd data-testid="territory-garrison">{fmtInt(state.garrison)}</dd>
          </div>
        )}
        {isProtected && (
          <div>
            <dt>Protégé jusqu'au</dt>
            <dd>{fmtDateTime(state!.protected_until!)}</dd>
          </div>
        )}
      </dl>

      {!me?.signed_in && (
        <div class="mt-4">
          <p class="mb-3 text-sm text-muted">Le jeu est réservé aux membres de GAL validés. Connectez-vous pour demander votre validation.</p>
          <DiscordButton returnPath="/compte" />
        </div>
      )}
      {why && (
        <p class="mt-4 text-sm text-muted" data-testid="action-why">
          {why}
        </p>
      )}

      {mode && (
        <form
          class="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label for="conq-amount" class="text-sm font-semibold">
            {mode === "start" ? "Garnison à y placer" : mode === "reinforce" ? "Troupes à ajouter" : "Troupes à envoyer"}
          </label>
          <input
            id="conq-amount"
            class="field tnum mt-1"
            type="number"
            inputMode="numeric"
            min={1}
            max={reserve}
            step={1}
            value={amount}
            data-testid="action-amount"
            onInput={(e) => setAmount(Math.floor(Number(e.currentTarget.value) || 0))}
          />
          <input class="film-range mt-2" type="range" min={0} max={Math.max(reserve, 1)} step={1} value={Math.min(amount, reserve)} aria-label="Part de la réserve à envoyer" onInput={(e) => setAmount(Number(e.currentTarget.value))} />
          <div class="mt-2 flex flex-wrap gap-2">
            {[20, 50, 100].map((share) => (
              <button key={share} type="button" class="chip !min-h-9" onClick={() => setAmount(Math.floor((reserve * share) / 100))}>
                {share} %
              </button>
            ))}
            {mode === "attack" && toWin <= reserve && (
              <button type="button" class="chip !min-h-9" onClick={() => setAmount(toWin)}>
                Juste assez : {fmtInt(toWin)}
              </button>
            )}
          </div>

          <p class="conq-preview tnum mt-3" data-testid="action-preview" aria-live="polite">
            {mode === "start" && `Le premier territoire est gratuit : ${willHold(amount)}.`}
            {mode === "expand" && (amount > cost ? `Le terrain coûte ${troops(cost)} : ${willHold(amount - cost)}.` : `Le terrain coûte ${troops(cost)} : envoyez-en plus pour pouvoir le tenir.`)}
            {mode === "reinforce" && `La garnison passera à ${fmtInt((state?.garrison ?? 0) + amount)}.`}
            {mode === "attack" &&
              attack &&
              (attack.won
                ? `Victoire prévue : ${fmtInt(Math.round(attack.losses))} pertes, ${willHold(attack.survivors)}.`
                : `Échec prévu : ${troops(amount)} ${amount > 1 ? "perdues" : "perdue"}, la garnison tomberait à ${fmtInt(attack.garrisonAfter)}. Il en faudrait ${fmtInt(toWin)} pour gagner.`)}
          </p>
          {mode === "expand" && expansionsLeft <= 0 && <p class="mt-2 text-sm text-warn">Vos conquêtes du jour sont faites : revenez demain.</p>}
          {mode === "attack" && attacksLeft <= 0 && <p class="mt-2 text-sm text-warn">Vos attaques du jour sont faites : revenez demain.</p>}
          {mode === "attack" && cooldown && <p class="mt-2 text-sm text-warn">Prochaine attaque possible le {fmtDateTime(cooldown)}.</p>}

          <button type="submit" class="btn btn-primary mt-3 w-full" disabled={busy || amount < 1} data-testid="action-submit">
            {busy ? "Envoi…" : ACTION_LABELS[mode]}
          </button>
        </form>
      )}
      <div class="mt-3">
        <Problem message={error} />
        {done && <Success message={done} />}
      </div>
    </div>
  );
}
