/**
 * Calculateur « Votre don sur la carte ». Il traduit des capsules en pixels avec les
 * règles relevées dans le code de la carte, et montre où le territoire pourrait
 * s'étendre. Tout est une simulation : rien n'est envoyé au jeu, aucune donnée ne change.
 */
import { clanRgb } from "../lib/clanmap/codec";
import { capsForNeutralPixels, capsToTroops, expansionOrder, neutralPixelsFor, objectiveFor, projectRank } from "../lib/clanmap/economy";
import { motionAllowed } from "../lib/fx/motion";
import type { StoredClanMapFilm } from "../lib/schemas";
import { loadFilmData, type FilmData } from "./film-data";

const fmt = new Intl.NumberFormat("fr-FR");
const TAG = "GAL";
const MAX_CAPS = 10_000_000;
const SIM_LIMIT = 500_000;
const FRAMING_CELLS = 4_000;

function init(): void {
  const found = document.querySelector<HTMLElement>("[data-conquest]");
  if (!found) return;
  const root: HTMLElement = found;
  const one = <T extends Element>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`élément manquant : ${selector}`);
    return el;
  };
  const input = one<HTMLInputElement>("[data-conquest-caps]");
  const range = one<HTMLInputElement>("[data-conquest-range]");
  const scopeChips = [...root.querySelectorAll<HTMLButtonElement>("[data-conquest-scope]")];
  const goal = root.querySelector<HTMLButtonElement>("[data-conquest-goal]");
  const totalCaps = one<HTMLElement>("[data-conquest-total]");
  const troops = one<HTMLElement>("[data-conquest-troops]");
  const pixels = one<HTMLElement>("[data-conquest-pixels]");
  const verdict = one<HTMLElement>("[data-conquest-verdict]");

  let everyone = false;
  let film: StoredClanMapFilm | null = null;
  const members = Number(root.dataset.members) || 1;
  let onPixels: (pixels: number) => void = () => {};

  /** Le curseur suit une échelle progressive : de 10 à plusieurs milliers de capsules. */
  const rangeToCaps = (v: number) => Math.round((10 ** (1 + (v / 100) * 3)) / 10) * 10;
  const capsToRange = (caps: number) => Math.max(0, Math.min(100, ((Math.log10(Math.max(10, caps)) - 1) / 3) * 100));

  function update(): void {
    const caps = Math.max(0, Math.min(MAX_CAPS, Math.floor(Number(input.value) || 0)));
    const total = caps * (everyone ? members : 1);
    const gained = capsToTroops(total);
    const painted = neutralPixelsFor(gained);
    totalCaps.textContent = fmt.format(total);
    troops.textContent = fmt.format(gained);
    pixels.textContent = fmt.format(painted);
    if (film) {
      const projection = projectRank(film.standings, TAG, painted);
      const me = objectiveFor(film.standings, TAG);
      if (projection && me) {
        const after = me.me.pixels + painted;
        let line = `GAL passerait de ${fmt.format(me.me.pixels)} à ${fmt.format(after)} pixels`;
        if (projection.passed.length > 0) line += `, et monterait ${projection.rank}${projection.rank === 1 ? "er" : "e"} en dépassant ${projection.passed.join(", ")}.`;
        else if (projection.next && projection.missing !== null) line += `. Il manquerait encore ${fmt.format(projection.missing)} pixels pour dépasser ${projection.next.tag ?? "le clan suivant"}.`;
        else line += ".";
        verdict.textContent = line;
      }
    }
    onPixels(painted);
  }

  input.addEventListener("input", () => {
    range.value = String(capsToRange(Number(input.value) || 0));
    update();
  });
  range.addEventListener("input", () => {
    input.value = String(rangeToCaps(Number(range.value)));
    update();
  });
  for (const chip of scopeChips) {
    chip.addEventListener("click", () => {
      everyone = chip.dataset.conquestScope === "all";
      for (const other of scopeChips) other.setAttribute("aria-pressed", String(other === chip));
      update();
    });
  }

  goal?.addEventListener("click", () => {
    const me = film && objectiveFor(film.standings, TAG);
    if (!me?.gap) return;
    everyone = true;
    for (const other of scopeChips) other.setAttribute("aria-pressed", String(other.dataset.conquestScope === "all"));
    const each = Math.ceil(capsForNeutralPixels(me.gap) / members);
    input.value = String(each);
    range.value = String(capsToRange(each));
    update();
  });

  /* ---------- Carte de la simulation ---------- */

  function startMap({ film: data, frames, terrain }: FilmData): void {
    const gal = data.gal;
    const canvas = one<HTMLCanvasElement>("[data-conquest-map]");
    const ctx = canvas.getContext("2d");
    if (gal === null || !ctx) return;
    const W = data.cols;
    const H = data.rows;
    const N = W * H;

    const owners = new Uint16Array(N);
    for (let i = 0; i < frames.cells.length; i++) owners[frames.cells[i]!] = frames.owners[i]!;

    // Le fond distingue la terre de la mer par sa teinte : la mer et les côtes sont plus bleues.
    const reader = document.createElement("canvas");
    reader.width = W;
    reader.height = H;
    const readerCtx = reader.getContext("2d", { willReadFrequently: true });
    if (!readerCtx) return;
    readerCtx.drawImage(terrain, 0, 0, W, H);
    const ground = readerCtx.getImageData(0, 0, W, H).data;
    const isLand = (cell: number) => {
      const o = cell * 4;
      return ground[o + 2]! - ground[o]! < 15;
    };

    // La carte d'aujourd'hui, les autres clans en retrait.
    const base = readerCtx.createImageData(W, H);
    const basePix = new Uint32Array(base.data.buffer);
    const [gr, gg, gb] = clanRgb(data.clans[gal]?.color ?? null);
    for (let i = 0; i < N; i++) {
      const v = owners[i]!;
      if (v === gal) basePix[i] = ((255 << 24) | (gb << 16) | (gg << 8) | gr) >>> 0;
      else if (v !== 0) {
        const [r, g, b] = clanRgb(data.clans[v]?.color ?? null);
        basePix[i] = ((110 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
    const baseLayer = document.createElement("canvas");
    baseLayer.width = W;
    baseLayer.height = H;
    baseLayer.getContext("2d")?.putImageData(base, 0, 0);

    const simLayer = document.createElement("canvas");
    simLayer.width = W;
    simLayer.height = H;
    const simCtx = simLayer.getContext("2d");
    if (!simCtx) return;
    const sim = simCtx.createImageData(W, H);
    const simPix = new Uint32Array(sim.data.buffer);
    const SIM_COLOR = ((255 << 24) | (255 << 16) | (240 << 8) | 190) >>> 0;
    const bloom = document.createElement("canvas");
    bloom.width = Math.ceil(W / 6);
    bloom.height = Math.ceil(H / 6);
    const bloomCtx = bloom.getContext("2d");

    const order = expansionOrder(owners, isLand, gal, W, H, SIM_LIMIT);
    let shown = 0;
    let target = 0;
    let raf = 0;

    // Le cadre suit les premières cases de l'expansion : c'est là que la simulation se voit le mieux.
    const sample = order.subarray(0, Math.min(order.length, FRAMING_CELLS));
    let sumX = 0;
    let sumY = 0;
    for (const cell of sample) {
      sumX += cell % W;
      sumY += Math.floor(cell / W);
    }
    const count = Math.max(1, sample.length);
    const centerX = sample.length ? sumX / count : W / 2;
    const centerY = sample.length ? sumY / count : H / 2;
    let spreadX = 0;
    let spreadY = 0;
    for (const cell of sample) {
      spreadX += ((cell % W) - centerX) ** 2;
      spreadY += (Math.floor(cell / W) - centerY) ** 2;
    }
    const center: [number, number, number, number] = [centerX, centerY, Math.sqrt(spreadX / count), Math.sqrt(spreadY / count)];
    const galCells = Math.max(1, data.galSummary ? data.galSummary.pixels / (data.scale * data.scale) : 1);

    function resize(): void {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(r.width * dpr));
      const height = Math.max(1, Math.round(r.height * dpr));
      if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
      }
      draw();
    }

    function draw(): void {
      const c = ctx!;
      const world = Math.min(canvas.width / W, canvas.height / H);
      // Plus la conquête grandit, plus la vue recule pour la montrer en entier.
      const growth = Math.sqrt((galCells + shown) / galCells);
      const halfW = Math.max(center[2] * 1.2, 240) * growth;
      const halfH = Math.max(center[3] * 1.2, 150) * growth;
      const scale = Math.max(world, Math.min(canvas.width / (2 * halfW), canvas.height / (2 * halfH)));
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.fillStyle = "#091426";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.setTransform(scale, 0, 0, scale, canvas.width / 2 - center[0] * scale, canvas.height / 2 - center[1] * scale);
      c.imageSmoothingEnabled = scale < 1;
      c.drawImage(terrain, 0, 0, W, H);
      c.drawImage(baseLayer, 0, 0);
      c.drawImage(simLayer, 0, 0);
      if (bloomCtx && shown > 0 && motionAllowed()) {
        bloomCtx.clearRect(0, 0, bloom.width, bloom.height);
        bloomCtx.drawImage(simLayer, 0, 0, bloom.width, bloom.height);
        c.globalCompositeOperation = "lighter";
        c.imageSmoothingEnabled = true;
        c.drawImage(bloom, 0, 0, W, H);
      }
    }

    function paint(next: number): void {
      const from = Math.min(shown, next);
      const to = Math.max(shown, next);
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let i = from; i < to; i++) {
        const cell = order[i]!;
        simPix[cell] = next > shown ? SIM_COLOR : 0;
        const x = cell % W;
        const y = Math.floor(cell / W);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x1 >= 0) simCtx!.putImageData(sim, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      shown = next;
    }

    function tick(): void {
      raf = 0;
      const gap = target - shown;
      if (gap === 0) return;
      const step = motionAllowed() ? Math.sign(gap) * Math.max(1, Math.ceil(Math.abs(gap) * 0.1)) : gap;
      paint(shown + step);
      draw();
      if (shown !== target) raf = requestAnimationFrame(tick);
    }

    onPixels = (painted) => {
      target = Math.min(order.length, Math.ceil(painted / (data.scale * data.scale)));
      if (!raf) raf = requestAnimationFrame(tick);
    };

    new ResizeObserver(resize).observe(canvas);
    canvas.hidden = false;
    for (const el of root.querySelectorAll<HTMLElement>("[data-conquest-map-ready]")) el.hidden = false;
    resize();
    update();
  }

  // Les commandes n'apparaissent qu'une fois les données prêtes : un clic n'est jamais perdu.
  // La carte de simulation, plus coûteuse, attend que le visiteur arrive jusqu'ici.
  loadFilmData(root.dataset.assets ?? "")
    .then((data) => {
      film = data.film;
      for (const el of root.querySelectorAll<HTMLElement>("[data-conquest-ready]")) el.hidden = false;
      update();
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer.disconnect();
          startMap(data);
        },
        { rootMargin: "400px 0px" },
      );
      observer.observe(root);
    })
    .catch((e) => console.warn("Calculateur de la carte indisponible :", e));
}

init();
