import { useMemo, useState } from "preact/hooks";
import { FORMULA_COMMIT, MAX_BOT_TILES, TERRAINS, minimumTroops, type Terrain } from "../lib/calculator";
import { fmtDec1, fmtInt } from "../lib/format";

function NumberField(props: { id: string; label: string; hint?: string; value: string; min: number; max?: number; onInput: (v: string) => void }) {
  return (
    <label class="block" htmlFor={props.id}>
      <span class="block text-sm font-semibold">{props.label}</span>
      {props.hint && <span class="block text-xs text-muted">{props.hint}</span>}
      <input
        id={props.id}
        class="field tnum mt-1"
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </label>
  );
}

const roundUp = (n: number) => (n < 1000 ? n : Math.ceil(n / 100) * 100);

export default function BotCalculator() {
  const [botTroops, setBotTroops] = useState("10000");
  const [botTiles, setBotTiles] = useState("1000");
  const [terrain, setTerrain] = useState<Terrain>("plains");
  const [border, setBorder] = useState("50");
  const [myTiles, setMyTiles] = useState("20000");

  const input = { botTroops: Number(botTroops), botTiles: Number(botTiles), border: Number(border), myTiles: Number(myTiles) };
  const key = JSON.stringify(input);
  const perTerrain = useMemo(
    () =>
      (Object.keys(TERRAINS) as Terrain[]).map((t) => ({ terrain: t, result: minimumTroops({ ...input, terrain: t }) })),
    [key],
  );
  const current = perTerrain.find((p) => p.terrain === terrain)?.result ?? null;

  return (
    <div class="card card-accent p-4 sm:p-6">
      <div class="grid gap-6 lg:grid-cols-2">
        <form class="grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} aria-label="Paramètres du calculateur">
          <NumberField id="calc-troops" label="Troupes du bot" hint="Un bot démarre à 10 000 dans le jeu." value={botTroops} min={1} onInput={setBotTroops} />
          <NumberField id="calc-tiles" label="Taille du bot" hint="En cases de territoire." value={botTiles} min={1} max={MAX_BOT_TILES} onInput={setBotTiles} />
          <label class="block" htmlFor="calc-terrain">
            <span class="block text-sm font-semibold">Terrain</span>
            <span class="block text-xs text-muted">Dominant chez le bot.</span>
            <select id="calc-terrain" class="field mt-1" value={terrain} onChange={(e) => setTerrain(e.currentTarget.value as Terrain)}>
              {(Object.keys(TERRAINS) as Terrain[]).map((t) => <option key={t} value={t}>{TERRAINS[t].label}</option>)}
            </select>
          </label>
          <NumberField id="calc-border" label="Frontière" hint="En cases. Change la durée, pas les pertes." value={border} min={1} onInput={setBorder} />
          <NumberField id="calc-mine" label="Votre territoire" hint="En cases. Effet surtout sur les très grands territoires." value={myTiles} min={1} onInput={setMyTiles} />
        </form>

        <div aria-live="polite" data-testid="calc-result">
          {current ? (
            <>
              <p class="text-sm font-semibold text-muted">Minimum pour conquérir tout le bot</p>
              <p class="tnum mt-1 font-display text-5xl font-extrabold" data-testid="calc-minimum">{fmtInt(roundUp(current.minimum))}</p>
              <p class="tnum mt-1 text-sm text-muted">
                soit {fmtDec1(current.multiple)} fois ses troupes, en {fmtDec1(current.seconds)} s environ avec cette frontière
              </p>
              <table class="data-table tnum mt-4 w-full text-sm">
                <caption class="sr-only">Minimum de troupes selon le terrain</caption>
                <thead>
                  <tr>
                    <th scope="col">Terrain</th>
                    <th scope="col" class="num">Troupes</th>
                    <th scope="col" class="num">Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {perTerrain.map((p) => (
                    <tr key={p.terrain} class={p.terrain === terrain ? "font-semibold" : ""}>
                      <td>{TERRAINS[p.terrain].label}</td>
                      <td class="num">{p.result ? fmtInt(roundUp(p.result.minimum)) : "—"}</td>
                      <td class="num">{p.result ? `${fmtDec1(p.result.seconds)} s` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p class="font-semibold text-warn" role="alert">
              Vérifiez les valeurs : nombres positifs, taille entière de {fmtInt(MAX_BOT_TILES)} cases au maximum.
            </p>
          )}
        </div>
      </div>

      <div class="mt-6 border-t border-line pt-4 text-sm text-muted">
        <p class="font-semibold text-white">Repère indicatif, pas une garantie.</p>
        <p class="mt-1">
          Le minimum laisse l'attaque à zéro à la dernière case : prévoyez de la marge. Le calcul suppose un terrain uniforme et ne compte ni la régénération du bot pendant l'attaque, ni les bâtiments. Il n'a pas été vérifié en partie réelle.
        </p>
        <details class="mt-3">
          <summary class="cursor-pointer font-semibold text-white">Voir la formule</summary>
          <p class="mt-2">À chaque case conquise, l'attaque perd :</p>
          <p class="mt-1 overflow-x-auto rounded bg-navy p-3 font-mono text-xs text-white" tabIndex={0}>
            M × 0,7 × borne(troupes du bot ÷ troupes d'attaque ; 0,6 ; 2) × (0,463 × bonus de taille + 0,0039 × troupes du bot ÷ cases du bot)
          </p>
          <p class="mt-2">
            M vaut 80 en plaine, 100 en colline et 120 en montagne. Le bot perd ses troupes par case à chaque case conquise. La frontière n'agit que sur la vitesse. Le minimum est trouvé en simulant l'attaque case par case.
          </p>
          <p class="mt-2">
            Source : <a href={`https://github.com/openfrontio/OpenFrontIO/blob/${FORMULA_COMMIT}/packages/engine/src/configuration/EngineConfig.ts`} rel="noopener">EngineConfig.ts d'OpenFront</a>, commit {FORMULA_COMMIT}. Le jeu évolue : ces constantes peuvent changer.
          </p>
        </details>
      </div>
    </div>
  );
}
