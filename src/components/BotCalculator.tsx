import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import AnimatedNumber from "./AnimatedNumber";
import { FORMULA_COMMIT, MAX_BOT_TILES, TERRAINS, minimumTroops, simulateTrace, type CalcInput, type Terrain } from "../lib/calculator";
import { fmtDec1, fmtInt } from "../lib/format";
import { motionAllowed } from "../lib/fx/motion";
import { coverWave, makeGrid } from "../lib/fx/territory";

const REPLAY_TILE = 12;
const REPLAY_MIN_SECONDS = 1.5;
const REPLAY_MAX_SECONDS = 6;
const REPLAY_HOLD_SECONDS = 1.6;

/**
 * Rejoue l'attaque selon le modèle du calculateur : le territoire du bot est
 * conquis pendant que les troupes de l'attaque fondent. Chaque valeur affichée
 * vient de `simulateTrace`. Sans animation, l'état final s'affiche directement.
 */
function AttackReplay({ input, attack }: { input: CalcInput; attack: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const troopsRef = useRef<HTMLSpanElement>(null);
  const tilesRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const inputKey = JSON.stringify(input);
  const trace = useMemo(() => simulateTrace(attack, input), [attack, inputKey]);
  const total = trace[trace.length - 1]?.seconds ?? 0;
  const playback = Math.max(REPLAY_MIN_SECONDS, Math.min(REPLAY_MAX_SECONDS, total));
  const speed = total / playback;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || canvas.clientWidth === 0) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grid = makeGrid(width, height, REPLAY_TILE);
    const order = coverWave(grid, 0, height / 2, 1, 7);

    const paint = (seconds: number) => {
      let i = 0;
      while (i < trace.length - 1 && (trace[i + 1]?.seconds ?? Infinity) <= seconds) i++;
      const a = trace[i];
      const b = trace[i + 1] ?? a;
      if (!a || !b) return;
      const t = b.seconds > a.seconds ? Math.min(1, (seconds - a.seconds) / (b.seconds - a.seconds)) : 0;
      const remaining = a.remaining + (b.remaining - a.remaining) * t;
      const conquered = a.conquered + (b.conquered - a.conquered) * t;
      const share = input.botTiles > 0 ? conquered / input.botTiles : 0;
      const lit = Math.floor(share * order.length);
      const front = Math.ceil(order.length * 0.04);

      ctx.clearRect(0, 0, width, height);
      order.forEach((tile, n) => {
        ctx.fillStyle = n >= lit ? "rgb(255 255 255 / 0.09)" : n >= lit - front && share < 1 ? "#ffffff" : "#3d7fff";
        ctx.fillRect((tile.index % grid.cols) * REPLAY_TILE + 1, Math.floor(tile.index / grid.cols) * REPLAY_TILE + 1, REPLAY_TILE - 2, REPLAY_TILE - 2);
      });
      if (troopsRef.current) troopsRef.current.textContent = fmtInt(remaining);
      if (tilesRef.current) tilesRef.current.textContent = `${fmtInt(share * 100)} %`;
      if (clockRef.current) clockRef.current.textContent = `${fmtDec1(seconds)} s sur ${fmtDec1(total)} s`;
    };

    if (!motionAllowed()) {
      paint(total);
      return;
    }

    let visible = true;
    let paused = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
    });
    observer.observe(canvas);
    let begin = performance.now();
    let raf = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (!motionAllowed()) {
        if (!paused) paint(total);
        paused = true;
        return;
      }
      paused = false;
      if (!visible) return;
      // L'horodatage d'une image peut précéder de peu `begin` : jamais de durée négative.
      const elapsed = Math.max(0, (now - begin) / 1000);
      if (elapsed > playback + REPLAY_HOLD_SECONDS) begin = now;
      paint((Math.min(playback, elapsed) / playback) * total);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [trace, total, playback]);

  return (
    <div class="mt-5" aria-hidden="true" data-testid="attack-replay">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 text-xs font-semibold text-muted">
        <span>Rejeu de l'attaque, avec cet envoi</span>
        <span>{speed > 1.05 ? `accéléré × ${fmtDec1(speed)}` : speed < 0.95 ? "ralenti" : "temps réel"}</span>
      </div>
      <canvas ref={canvasRef} class="mt-2 block h-24 w-full" />
      <div class="tnum mt-2 flex flex-wrap justify-between gap-x-4 text-sm">
        <span>Troupes : <strong data-testid="replay-troops" ref={troopsRef} /></span>
        <span>Bot conquis : <strong ref={tilesRef} /></span>
        <span class="text-muted" ref={clockRef} />
      </div>
    </div>
  );
}

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
  const form = useRef<HTMLFormElement>(null);

  // Le visiteur a pu modifier un champ avant que la page devienne interactive.
  useEffect(() => {
    const field = (id: string) => (form.current?.elements.namedItem(id) as HTMLInputElement | HTMLSelectElement | null)?.value;
    const typed = {
      troops: field("calc-troops"),
      tiles: field("calc-tiles"),
      terrain: field("calc-terrain"),
      border: field("calc-border"),
      mine: field("calc-mine"),
    };
    if (typed.troops) setBotTroops(typed.troops);
    if (typed.tiles) setBotTiles(typed.tiles);
    if (typed.terrain) setTerrain(typed.terrain as Terrain);
    if (typed.border) setBorder(typed.border);
    if (typed.mine) setMyTiles(typed.mine);
  }, []);

  const input = { botTroops: Number(botTroops), botTiles: Number(botTiles), border: Number(border), myTiles: Number(myTiles) };
  const key = JSON.stringify(input);
  const perTerrain = useMemo(
    () =>
      (Object.keys(TERRAINS) as Terrain[]).map((t) => ({ terrain: t, result: minimumTroops({ ...input, terrain: t }) })),
    [key],
  );
  const current = perTerrain.find((p) => p.terrain === terrain)?.result ?? null;
  const highest = Math.max(1, ...perTerrain.map((p) => p.result?.minimum ?? 0));

  return (
    <div class="card card-accent p-4 sm:p-6">
      <div class="grid gap-6 lg:grid-cols-2">
        <form ref={form} class="grid content-start gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} aria-label="Paramètres du calculateur">
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
              <p class="tnum mt-1 font-display text-5xl font-extrabold">
                <AnimatedNumber value={roundUp(current.minimum)} format={fmtInt} duration={350} testId="calc-minimum" />
              </p>
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
                      <td class="num">
                        {p.result && <span class="score-bar" aria-hidden="true" style={{ width: `${(p.result.minimum / highest) * 100}%` }} />}
                        <span class="relative">{p.result ? fmtInt(roundUp(p.result.minimum)) : "—"}</span>
                      </td>
                      <td class="num">{p.result ? `${fmtDec1(p.result.seconds)} s` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <AttackReplay input={{ ...input, terrain }} attack={current.minimum} />
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
