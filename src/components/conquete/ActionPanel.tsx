import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { call, newRequestId } from "../../lib/conquete/api";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { BUILDINGS, TERRAIN_LABELS, buildingCost, defenceFactor, neutralCost, resolveAttack, troopsForRatio, troopsToWin, type BuildingKind } from "../../lib/conquete/rules";
import type { MapTerritory, Me, MyGame, Player, Season, TerritoryState } from "../../lib/conquete/types";
import { DiscordButton, Problem, Success, messageOf } from "./common";

export type Mode = "start" | "expand" | "attack" | "reinforce";

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
  /** Les joueurs avec qui je suis allié. */
  allies: ReadonlySet<number>;
  /** La terre visée est couverte par un poste de défense de son propriétaire. */
  fortified: boolean;
  /** Combien j'ai de bâtiments de chaque type, et si j'ai un silo. */
  myBuildings: Readonly<Partial<Record<BuildingKind, number>>>;
  /** Le ratio d'attaque choisi dans la barre de commande, en %. */
  ratio: number;
  onRatio: (percent: number) => void;
  /** Change à chaque second clic sur la terre choisie : l'action part alors sans repasser par le bouton. */
  fire: number;
  /** Les terres encore libres sur la carte. */
  freeLands: number;
  onDone: () => Promise<void>;
  /** Une action a réussi : le guide en a besoin pour avancer. */
  onAction?: (mode: Mode) => void;
  /** Referme la terre choisie : sur téléphone, le panneau recouvre le bas de la carte. */
  onClose?: () => void;
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
const BUILD_ORDER: BuildingKind[] = ["city", "port", "post", "sam", "silo"];

/** Ce que peut faire le joueur ici, ou pourquoi il ne le peut pas. */
function modeFor({ season, territory, state, me, mine, myNumber, owned, allies }: Props): { mode: Mode | null; why: string | null } {
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
  if (state && allies.has(state.owner)) return { mode: null, why: "Ce joueur est votre allié : rompez d'abord l'alliance pour l'attaquer." };
  const adjacent = territory.neighbours.some((n) => owned.has(n));
  if (!adjacent) return { mode: null, why: "Ce territoire n'est pas voisin des vôtres." };
  if (!state) return { mode: "expand", why: null };
  if (season.phase !== "war") return { mode: null, why: "Il appartient à un autre membre : la guerre n'a pas encore commencé." };
  return { mode: "attack", why: null };
}

/** Une action qu'on ne rattrape pas ne part qu'au second clic. */
function ArmedButton({ label, armedLabel, busy, onConfirm, testid }: { label: string; armedLabel: string; busy: boolean; onConfirm: () => void; testid?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      class="btn btn-ghost !min-h-10 w-full !py-1.5 !text-sm"
      disabled={busy}
      data-testid={testid}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? armedLabel : label}
    </button>
  );
}

export default function ActionPanel(props: Props) {
  const { season, territory, state, owner, me, mine, allies, fortified, myBuildings, ratio, onRatio, fire, freeLands, onDone, onAction, onClose, myNumber } = props;
  const { mode, why } = modeFor(props);
  const config = season.config;
  const reserve = mine?.in_game === false ? (mine.start_troops ?? 0) : (mine?.troops ?? 0);
  const gold = mine?.gold ?? 0;
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cost = territory ? neutralCost(territory.terrain, config) : 0;
  const traitor = owner?.traitor_until ? Date.parse(owner.traitor_until) > Date.now() : false;
  const factor = defenceFactor(fortified, traitor, config);
  const toWin = useMemo(() => (territory && state ? troopsToWin(state.garrison, territory.terrain, config, factor) : 0), [territory, state, config, factor]);
  const validated = me?.signed_in && me.status === "validated" && !mine?.excluded;
  const inGame = validated && props.owned.size > 0;
  const isEnemy = state !== null && state.owner !== myNumber;
  const ownerIsAlly = isEnemy && allies.has(state.owner);
  const requested = isEnemy && (mine?.alliance_requests ?? []).some((r) => r.number === state.owner);
  const sent = isEnemy && (mine?.alliance_sent ?? []).includes(state.owner);

  // À chaque territoire et à chaque changement de ratio, l'envoi suit le ratio. Sur une terre libre, il couvre au moins le terrain.
  // Avant l'affichage, et non après : cela ne doit jamais écraser ce que le joueur vient de taper.
  useLayoutEffect(() => {
    const share = troopsForRatio(reserve, ratio);
    setAmount(mode === "expand" ? Math.min(reserve, Math.max(cost + 500, share)) : share);
    // Ne repropose qu'en changeant de territoire, d'action ou de ratio, ou quand la réserve vient d'être lue.
  }, [territory?.id, mode, ratio, reserve === 0]);

  // Le résultat d'une action reste affiché : il ne s'efface qu'en changeant de territoire.
  useEffect(() => {
    setError(null);
    setDone(null);
  }, [territory?.id]);

  // Après une action, la réserve a baissé : l'envoi proposé ne doit pas la dépasser.
  useEffect(() => {
    if (amount > reserve) setAmount(troopsForRatio(reserve, ratio));
  }, [reserve]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await action());
      await onDone();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const isProtected = state?.protected_until ? Date.parse(state.protected_until) > Date.now() : false;
  const attack = mode === "attack" && amount >= 1 && territory ? resolveAttack(amount, state!.garrison, territory.terrain, config, factor) : null;
  const expansionsLeft = config.limits.expansionsPerDay - (mine?.expansions_today ?? 0);
  const attacksLeft = config.limits.attacksPerDay - (mine?.attacks_today ?? 0);
  const cooldown = mine?.cooldown_until && Date.parse(mine.cooldown_until) > Date.now() ? mine.cooldown_until : null;
  // Ce que le serveur refuserait de toute façon : l'écran ne promet donc pas une victoire.
  const lastStand = mode === "attack" && config.limits.lastTerritoryProtected && owner?.territories === 1;
  const refused = mode === "attack" && (isProtected || lastStand);

  /** Le second clic sur la carte ne part que si l'écran vient d'annoncer un succès. */
  const secondClickAllowed = !busy && (mode === "expand" ? amount > cost && expansionsLeft > 0 : mode === "attack" && !refused && attack?.won === true && attacksLeft > 0 && !cooldown);

  const send = () => {
    if (!territory || !mode) return;
    const action = mode;
    void run(async () => {
      const args = { p_request_id: newRequestId(), p_territory: territory.id };
      let message: string;
      if (action === "start") {
        await call("choose_start", { ...args, p_garrison: amount });
        message = `Vous vous installez à ${territory.name}, avec ${troops(amount)}.`;
      } else if (action === "expand") {
        const res = await call<{ garrison: number }>("expand", { ...args, p_troops: amount });
        message = `${territory.name} est à vous : ${holds(res.garrison)}.`;
      } else if (action === "reinforce") {
        const res = await call<{ garrison: number }>("reinforce", { ...args, p_troops: amount });
        message = `${territory.name} compte maintenant ${troops(res.garrison)}.`;
      } else {
        const res = await call<{ won: boolean; losses: number; garrison_after: number }>("attack", { ...args, p_troops: amount });
        message = res.won ? `Victoire ! ${territory.name} est à vous : ${holds(res.garrison_after)}.` : `L'attaque a échoué : la garnison de ${territory.name} tombe à ${fmtInt(res.garrison_after)}.`;
      }
      onAction?.(action);
      return message;
    });
  };

  // Le second clic sur la carte : seulement pour conquérir ou attaquer, jamais pour dépenser ailleurs par mégarde.
  const lastFire = useRef(fire);
  useEffect(() => {
    if (fire === lastFire.current) return;
    lastFire.current = fire;
    if (secondClickAllowed) send();
  }, [fire]);

  if (!territory) {
    const starting = validated && props.owned.size === 0;
    return (
      <div class="conq-side-empty" data-testid="action-panel">
        {starting && freeLands === 0 ? (
          <p class="font-semibold">Toutes les terres sont occupées : vous pourrez jouer à la prochaine saison.</p>
        ) : starting ? (
          <>
            <p class="font-semibold">Choisissez votre terre de départ</p>
            <p class="mt-1 text-sm text-muted">Cliquez une terre libre sur la carte. Rien ne part avant que vous ayez confirmé.</p>
          </>
        ) : inGame ? (
          <>
            <p class="font-semibold">Choisissez une terre sur la carte</p>
            <p class="mt-1 text-sm text-muted">Un clic pour voir le résultat prévu, un second clic pour y aller.</p>
          </>
        ) : (
          <>
            <p class="font-semibold">Choisissez une terre sur la carte</p>
            <p class="mt-1 text-sm text-muted">Vous verrez son terrain, son propriétaire et sa garnison.</p>
          </>
        )}
      </div>
    );
  }

  const bombCooldown = mine?.bomb_ready_at && Date.parse(mine.bomb_ready_at) > Date.now() ? mine.bomb_ready_at : null;
  const building = state?.building ?? null;

  return (
    <div data-testid="action-panel">
      <div class="flex items-start justify-between gap-2">
        <h3 class="text-xl" id="conq-territory-name" tabIndex={-1} data-testid="territory-name">
          {territory.name}
        </h3>
        {onClose && (
          <button type="button" class="conq-close" aria-label="Fermer ce territoire" data-testid="territory-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <dl class="conq-facts tnum mt-3">
        <div>
          <dt>Terrain</dt>
          <dd>{TERRAIN_LABELS[territory.terrain]}</dd>
        </div>
        <div>
          <dt>Propriétaire</dt>
          <dd>
            {owner ? owner.name : state ? "Ancien membre" : "Terre libre"}
            {ownerIsAlly ? " (allié)" : ""}
            {traitor ? " (traître)" : ""}
          </dd>
        </div>
        {state && (
          <div>
            <dt>Garnison</dt>
            <dd data-testid="territory-garrison">{fmtInt(state.garrison)}</dd>
          </div>
        )}
        {building && (
          <div>
            <dt>Bâtiment</dt>
            <dd data-testid="territory-building">{BUILDINGS[building].label}</dd>
          </div>
        )}
        {isEnemy && fortified && (
          <div>
            <dt>Défense</dt>
            <dd>Poste de défense</dd>
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
          data-guide="action"
          onSubmit={(e) => {
            e.preventDefault();
            send();
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
          <div class="mt-2 flex flex-wrap gap-2">
            {[20, 50, 100].map((share) => (
              <button
                key={share}
                type="button"
                class="chip !min-h-9"
                aria-pressed={ratio === share}
                onClick={() => {
                  onRatio(share);
                  setAmount(troopsForRatio(reserve, share));
                }}
              >
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
            {refused && (isProtected ? `Cette terre est protégée jusqu'au ${fmtDateTime(state!.protected_until!)} : une attaque serait refusée.` : "C'est le dernier territoire de ce joueur : il ne peut pas être attaqué.")}
            {mode === "start" && `Le premier territoire est gratuit : ${willHold(amount)}.`}
            {mode === "expand" && (amount > cost ? `Le terrain coûte ${troops(cost)} : ${willHold(amount - cost)}.` : `Le terrain coûte ${troops(cost)} : envoyez-en plus pour pouvoir le tenir.`)}
            {mode === "reinforce" && `La garnison passera à ${fmtInt((state?.garrison ?? 0) + amount)}.`}
            {mode === "attack" &&
              !refused &&
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
          {secondClickAllowed && <p class="mt-1 text-center text-xs text-muted">ou cliquez encore sur la terre</p>}
          {mode === "attack" && !refused && attack && !attack.won && <p class="mt-1 text-center text-xs text-muted">Attaque annoncée perdante : seul ce bouton la lance.</p>}
        </form>
      )}

      {/* Construire sur une de ses terres. */}
      {inGame && state?.owner === myNumber && !building && (
        <section class="mt-4 border-t border-line pt-3" data-testid="build-menu" data-guide="build">
          <h4 class="text-sm font-bold">Construire ici</h4>
          <ul class="mt-2 grid gap-1.5">
            {BUILD_ORDER.map((kind) => {
              const price = buildingCost(kind, myBuildings[kind] ?? 0, config);
              return (
                <li key={kind}>
                  <button
                    type="button"
                    class="conq-build"
                    disabled={busy || gold < price}
                    data-testid={`build-${kind}`}
                    onClick={() =>
                      void run(async () => {
                        await call("build", { p_request_id: newRequestId(), p_territory: territory.id, p_kind: kind });
                        return `${BUILDINGS[kind].label} construit à ${territory.name}.`;
                      })
                    }
                  >
                    <span class="conq-build-mark" aria-hidden="true">
                      {BUILDINGS[kind].mark}
                    </span>
                    <span class="min-w-0">
                      <span class="block font-semibold">{BUILDINGS[kind].label}</span>
                      <span class="block text-xs text-muted">{BUILDINGS[kind].effect(config)}</span>
                    </span>
                    <span class="tnum text-sm font-bold">{fmtInt(price)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {inGame && state?.owner === myNumber && building && <p class="mt-3 text-xs text-muted">{BUILDINGS[building].effect(config)}.</p>}

      {/* Parler au propriétaire de cette terre : s'allier, trahir, bombarder. */}
      {inGame && isEnemy && owner && (
        <section class="mt-4 grid gap-1.5 border-t border-line pt-3" data-testid="diplomacy" data-guide="diplomacy">
          {ownerIsAlly ? (
            <ArmedButton
              label="Rompre l'alliance"
              armedLabel="Trahir, aux yeux de tous ?"
              busy={busy}
              testid="alliance-break"
              onConfirm={() =>
                void run(async () => {
                  await call("break_alliance", { p_number: owner.number });
                  return `Vous avez trahi ${owner.name}. Tout le monde le sait, et vous attaquer coûte moitié moins pendant ${config.alliance.traitorHours} heures.`;
                })
              }
            />
          ) : sent ? (
            <p class="text-sm text-muted">Alliance proposée : elle attend sa réponse.</p>
          ) : (
            <button
              type="button"
              class="btn btn-ghost !min-h-10 w-full !py-1.5 !text-sm"
              disabled={busy}
              data-testid="alliance-propose"
              onClick={() =>
                void run(async () => {
                  const res = await call<{ status: string }>("propose_alliance", { p_number: owner.number });
                  return res.status === "active" ? `Vous êtes maintenant allié à ${owner.name}.` : `Alliance proposée à ${owner.name}.`;
                })
              }
            >
              {requested ? "Accepter son alliance" : "Proposer une alliance"}
            </button>
          )}
          {(myBuildings.silo ?? 0) > 0 && season.phase === "war" && !ownerIsAlly && (
            <>
              <ArmedButton
                label={`Lancer une bombe (${fmtInt(config.structures.bombCost)} or)`}
                armedLabel={`Confirmer : ${Math.round(config.structures.bombDamage * 100)} % de la garnison, et le bâtiment`}
                busy={busy || gold < config.structures.bombCost || bombCooldown !== null || isProtected}
                testid="bomb-launch"
                onConfirm={() =>
                  void run(async () => {
                    const res = await call<{ intercepted: boolean; garrison_after: number }>("launch_bomb", { p_request_id: newRequestId(), p_territory: territory.id });
                    return res.intercepted ? "Votre bombe a été arrêtée par sa défense antiaérienne." : `Bombe tombée sur ${territory.name} : il reste ${troops(res.garrison_after)}.`;
                  })
                }
              />
              {bombCooldown && <p class="text-xs text-muted">Votre silo recharge jusqu'au {fmtDateTime(bombCooldown)}.</p>}
            </>
          )}
        </section>
      )}

      <div class="mt-3">
        <Problem message={error} />
        {done && <Success message={done} />}
      </div>
    </div>
  );
}
