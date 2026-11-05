/**
 * Effets interactifs du site, autour d'une même idée : la conquête de territoire.
 * Tout est décoratif : sans ce script, avec « réduire les animations » ou avec le
 * bouton pause, le site reste complet.
 *
 * - curseur : les cases s'allument, les blocs s'inclinent, un halo le suit ;
 * - clic gauche : vague bleue ; clic droit : vague rouge ;
 * - blocs : conquis case par case à leur apparition, frontière qui fait leur tour ;
 * - graphiques : onde au clic, réticule sur la heatmap, infobulles.
 */
import {
  TILE_SIZE,
  brush,
  coverWave,
  decay,
  makeGrid,
  planWave,
  segment,
  tilePath,
  type Arrival,
  type Grid,
} from "../lib/fx/territory";

const STORAGE_KEY = "gal-fx";
/** Le clic droit garde son menu habituel sur ces éléments, et sur le texte sélectionné. */
const NATIVE_MENU = "a, button, input, select, textarea, summary, label, video, [contenteditable], img:not([data-fx-logo])";
const NO_WAVE = "input, select, textarea";
const BLOCKS = ".stage, main .card";
const MAX_WAVES = 8;
const MAX_ALPHA = 0.5;
/** Inclinaison maximale d'une grande scène, en degrés : au-delà, le texte perd en netteté. */
const STAGE_TILT = 0.8;
const CARD_TILT = 3;
const CONQUEST_TILE = 32;
/** Au-delà de cette hauteur, un bloc apparaît en fondu : son tracé serait trop lourd. */
const CONQUEST_MAX_HEIGHT = 900;
const FLASH_TTL = 0.32;
const LOCAL_TTL = 0.7;

type Owner = 1 | 2 | 3;
type Side = "left" | "right";
const BLUE: Owner = 1;
const RED: Owner = 2;
const WHITE: Owner = 3;
const COLORS = ["", "#3d7fff", "#ff2b3f", "#dfe7ff"] as const;

interface Wave {
  arrivals: Arrival[];
  next: number;
  start: number;
  owner: Owner;
  strength: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
}
interface Ring {
  x: number;
  y: number;
  life: number;
  ttl: number;
  radius: number;
  color: string;
}
interface Flash {
  x: number;
  y: number;
  size: number;
  life: number;
  color: string;
}
interface Conquest {
  el: HTMLElement;
  start: number;
  grid: Grid | null;
  arrivals: Arrival[];
  next: number;
  path: string;
  color: string;
}
interface LocalWave {
  el: HTMLElement;
  grid: Grid;
  arrivals: Arrival[];
  first: number;
  start: number;
  color: string;
  radius: number;
}
interface Tilt {
  el: HTMLElement;
  rx: number;
  ry: number;
  scale: number;
  targetRx: number;
  targetRy: number;
  targetScale: number;
  perspective: number;
}

function storePreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Stockage indisponible : le choix vaut seulement pour cette page.
  }
}

function init(): void {
  const root = document.documentElement;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const tiltSelector = CSS.supports("selector(:has(a))")
    ? ".stage, [data-tilt], main .card:not(:has(table, input, select, canvas))"
    : ".stage, [data-tilt]";
  let enabled = !root.classList.contains("fx-off");

  /* ---------- Éléments créés par le script ---------- */

  const makeCanvas = (id: string): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
    return canvas;
  };
  const makeLayer = (id: string): HTMLDivElement => {
    const layer = document.createElement("div");
    layer.id = id;
    layer.setAttribute("aria-hidden", "true");
    document.body.prepend(layer);
    return layer;
  };
  const territory = makeCanvas("fx-territory");
  const sparksCanvas = makeCanvas("fx-sparks");
  const aurora = makeLayer("fx-aurora");
  const progress = makeLayer("fx-progress");
  const tip = makeLayer("fx-tip");
  tip.hidden = true;

  const tileCtx = territory.getContext("2d");
  const sparkCtx = sparksCanvas.getContext("2d");
  if (!tileCtx || !sparkCtx) {
    root.classList.remove("fx-wait");
    return;
  }

  /* ---------- Grille de territoire, derrière la page ---------- */

  let grid: Grid = makeGrid(1, 1);
  let levels = new Float32Array(1);
  let owners = new Uint8Array(1);
  let isHot = new Uint8Array(1);
  let hot: number[] = [];
  let waves: Wave[] = [];
  let width = 0;
  let height = 0;
  let tilesDrawn = false;
  let seed = 1;

  function resize(): void {
    const w = territory.clientWidth;
    const h = territory.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const [canvas, ctx] of [
      [territory, tileCtx],
      [sparksCanvas, sparkCtx],
    ] as const) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    grid = makeGrid(w, h);
    const total = grid.cols * grid.rows;
    levels = new Float32Array(total);
    owners = new Uint8Array(total);
    isHot = new Uint8Array(total);
    hot = [];
    waves = [];
  }

  function light(index: number, owner: Owner, strength: number): void {
    if (index < 0 || index >= levels.length) return;
    if (owners[index] !== owner) {
      // Une nouvelle couleur prend la case, comme dans une conquête.
      if (strength < (levels[index] ?? 0) * 0.5) return;
      owners[index] = owner;
      levels[index] = strength;
    } else if (strength > (levels[index] ?? 0)) {
      levels[index] = strength;
    }
    if (!isHot[index]) {
      isHot[index] = 1;
      hot.push(index);
    }
  }

  function launchWave(x: number, y: number, owner: Owner, radius: number, speed: number, strength: number): void {
    seed = (seed + 1) % 1000;
    waves.push({ arrivals: planWave(grid, x, y, radius, speed, seed), next: 0, start: performance.now(), owner, strength });
    if (waves.length > MAX_WAVES) waves.shift();
  }

  function updateWaves(now: number): void {
    waves = waves.filter((wave) => {
      const elapsed = Math.max(0, (now - wave.start) / 1000);
      while (wave.next < wave.arrivals.length) {
        const arrival = wave.arrivals[wave.next];
        if (!arrival || arrival.at > elapsed) break;
        light(arrival.index, wave.owner, wave.strength);
        wave.next++;
      }
      return wave.next < wave.arrivals.length;
    });
  }

  function drawTiles(dt: number): void {
    if (!tileCtx) return;
    if (hot.length === 0 && !tilesDrawn) return;
    tileCtx.clearRect(0, 0, width, height);
    const { cols, size } = grid;
    const stillHot: number[] = [];
    for (const index of hot) {
      const level = decay(levels[index] ?? 0, dt);
      if (level < 0.015) {
        levels[index] = 0;
        owners[index] = 0;
        isHot[index] = 0;
        continue;
      }
      levels[index] = level;
      stillHot.push(index);
      const owner = owners[index] ?? 0;
      tileCtx.globalAlpha = Math.min(1, level) * MAX_ALPHA * (owner === WHITE ? 0.45 : 1);
      tileCtx.fillStyle = COLORS[owner as Owner] ?? COLORS[BLUE];
      tileCtx.fillRect((index % cols) * size + 1, Math.floor(index / cols) * size + 1, size - 2, size - 2);
    }
    hot = stillHot;
    tileCtx.globalAlpha = 1;
    tilesDrawn = hot.length > 0;
  }

  /* ---------- Vie ambiante : des territoires qui naissent seuls ---------- */

  let nextAmbient = 0;
  function updateAmbient(now: number): void {
    if (now < nextAmbient) return;
    nextAmbient = now + (finePointer ? 900 + Math.random() * 900 : 2500 + Math.random() * 1500);
    const roll = Math.random();
    const owner = roll < 0.6 ? BLUE : roll < 0.85 ? RED : WHITE;
    launchWave(Math.random() * width, Math.random() * height, owner, 60 + Math.random() * 110, 130 + Math.random() * 70, 0.26 + Math.random() * 0.1);
  }

  /* ---------- Conquête d'un bloc, case par case ---------- */

  let conquests: Conquest[] = [];
  let flashes: Flash[] = [];
  let nextSlot = 0;

  function traceFrontier(el: HTMLElement): void {
    if (el.classList.contains("fx-traced")) return;
    el.classList.add("fx-traced");
    window.setTimeout(() => el.classList.remove("fx-traced"), 1700);
  }

  function queueConquest(el: HTMLElement, now: number): void {
    const start = Math.max(now, nextSlot);
    nextSlot = start + 90;
    conquests.push({
      el,
      start,
      grid: null,
      arrivals: [],
      next: 0,
      path: "",
      color: COLORS[el.classList.contains("stage-wine") ? RED : BLUE],
    });
  }

  function updateConquests(now: number): void {
    conquests = conquests.filter((c) => {
      if (now < c.start) return true;
      const r = c.el.getBoundingClientRect();
      if (!c.grid) {
        if (!c.el.isConnected || r.width === 0) {
          c.el.classList.remove("fx-hidden");
          return false;
        }
        c.grid = makeGrid(r.width, r.height, CONQUEST_TILE);
        // La conquête part du point du bloc le plus proche du curseur.
        const originX = pointer.seen ? Math.max(0, Math.min(r.width, pointer.x - r.left)) : 0;
        const originY = pointer.seen ? Math.max(0, Math.min(r.height, pointer.y - r.top)) : r.height;
        seed = (seed + 1) % 1000;
        const duration = Math.min(0.95, 0.45 + (r.width * r.height) / 1_200_000);
        c.arrivals = coverWave(c.grid, originX, originY, duration, seed);
        c.start = now;
        c.el.style.clipPath = 'path("M0 0")';
        c.el.classList.remove("fx-hidden");
      }
      const elapsed = Math.max(0, (now - c.start) / 1000);
      const { cols, size } = c.grid;
      let changed = false;
      while (c.next < c.arrivals.length) {
        const arrival = c.arrivals[c.next];
        if (!arrival || arrival.at > elapsed) break;
        c.path += tilePath(arrival.index, c.grid);
        if (flashes.length < 1200) {
          flashes.push({
            x: r.left + (arrival.index % cols) * size,
            y: r.top + Math.floor(arrival.index / cols) * size,
            size,
            life: 0,
            color: c.color,
          });
        }
        c.next++;
        changed = true;
      }
      if (c.next >= c.arrivals.length) {
        c.el.style.clipPath = "";
        traceFrontier(c.el);
        return false;
      }
      if (changed) c.el.style.clipPath = `path("${c.path}")`;
      return true;
    });
  }

  /* ---------- La frontière fait parfois le tour d'un bloc visible ---------- */

  const visibleBlocks = new Set<HTMLElement>();
  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleBlocks.add(entry.target as HTMLElement);
      else visibleBlocks.delete(entry.target as HTMLElement);
    }
  });
  let nextTrace = 0;

  function updateTraces(now: number): void {
    if (now < nextTrace || visibleBlocks.size === 0) return;
    nextTrace = now + 1400 + Math.random() * 1400;
    const candidates = [...visibleBlocks];
    const el = candidates[Math.floor(Math.random() * candidates.length)];
    if (el?.isConnected) traceFrontier(el);
  }

  /* ---------- Éclats, onde de choc et ondes dans les blocs, par-dessus la page ---------- */

  let sparks: Spark[] = [];
  let rings: Ring[] = [];
  let locals: LocalWave[] = [];
  let sparksDrawn = false;

  function burst(x: number, y: number, side: Side, big = false): void {
    const owner = side === "left" ? BLUE : RED;
    launchWave(x, y, owner, big ? 520 : 380, 760, 1);
    const main = COLORS[owner];
    const other = COLORS[side === "left" ? RED : BLUE];
    const palette = [main, main, main, "#ffffff", "#ffffff", other];
    const count = (finePointer ? 18 : 10) * (big ? 2 : 1);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 180 + Math.random() * (big ? 520 : 340);
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        life: 0,
        ttl: 0.45 + Math.random() * 0.45,
        size: 3 + Math.random() * 5,
        color: palette[i % palette.length] ?? main,
      });
    }
    rings.push({ x, y, life: 0, ttl: 0.55, radius: big ? 190 : 120, color: main });
    if (sparks.length > 200) sparks = sparks.slice(-200);
  }

  /** L'onde traverse aussi le bloc cliqué, qui cache la grille de fond. */
  function launchLocal(el: HTMLElement, x: number, y: number, side: Side): void {
    const r = el.getBoundingClientRect();
    if (r.height > CONQUEST_MAX_HEIGHT * 1.5) return;
    const localGrid = makeGrid(r.width, r.height, TILE_SIZE);
    seed = (seed + 1) % 1000;
    locals.push({
      el,
      grid: localGrid,
      arrivals: coverWave(localGrid, x - r.left, y - r.top, 0.6, seed),
      first: 0,
      start: performance.now(),
      color: COLORS[side === "left" ? BLUE : RED],
      radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
    });
    if (locals.length > 3) locals.shift();
  }

  function drawLocals(now: number): void {
    if (!sparkCtx) return;
    locals = locals.filter((wave) => {
      const elapsed = Math.max(0, (now - wave.start) / 1000);
      const r = wave.el.getBoundingClientRect();
      sparkCtx.save();
      sparkCtx.beginPath();
      if (typeof sparkCtx.roundRect === "function") sparkCtx.roundRect(r.left, r.top, r.width, r.height, wave.radius);
      else sparkCtx.rect(r.left, r.top, r.width, r.height);
      sparkCtx.clip();
      sparkCtx.fillStyle = wave.color;
      const { cols, size } = wave.grid;
      for (let i = wave.first; i < wave.arrivals.length; i++) {
        const arrival = wave.arrivals[i];
        if (!arrival) break;
        const age = elapsed - arrival.at;
        if (age < 0) break;
        if (age >= LOCAL_TTL) {
          if (i === wave.first) wave.first++;
          continue;
        }
        sparkCtx.globalAlpha = 0.3 * (1 - age / LOCAL_TTL);
        sparkCtx.fillRect(r.left + (arrival.index % cols) * size + 1, r.top + Math.floor(arrival.index / cols) * size + 1, size - 2, size - 2);
      }
      sparkCtx.restore();
      return wave.first < wave.arrivals.length;
    });
  }

  function drawOverlay(now: number, dt: number): void {
    if (!sparkCtx) return;
    const active = sparks.length + rings.length + flashes.length + locals.length > 0;
    if (!active && !sparksDrawn) return;
    sparkCtx.clearRect(0, 0, width, height);
    drawLocals(now);
    flashes = flashes.filter((f) => {
      f.life += dt;
      if (f.life >= FLASH_TTL) return false;
      sparkCtx.globalAlpha = 0.75 * (1 - f.life / FLASH_TTL);
      sparkCtx.fillStyle = f.life < FLASH_TTL * 0.3 ? "#ffffff" : f.color;
      sparkCtx.fillRect(f.x + 1, f.y + 1, f.size - 2, f.size - 2);
      return true;
    });
    sparks = sparks.filter((s) => {
      s.life += dt;
      if (s.life >= s.ttl) return false;
      s.vy += 900 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      sparkCtx.globalAlpha = 1 - s.life / s.ttl;
      sparkCtx.fillStyle = s.color;
      sparkCtx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      return true;
    });
    rings = rings.filter((r) => {
      r.life += dt;
      const t = r.life / r.ttl;
      if (t >= 1) return false;
      sparkCtx.globalAlpha = 0.8 * (1 - t);
      sparkCtx.strokeStyle = r.color;
      sparkCtx.lineWidth = 4 * (1 - t) + 0.5;
      sparkCtx.beginPath();
      sparkCtx.arc(r.x, r.y, r.radius * (1 - (1 - t) ** 3), 0, Math.PI * 2);
      sparkCtx.stroke();
      return true;
    });
    sparkCtx.globalAlpha = 1;
    sparksDrawn = active;
  }

  /** Une onde se propage dans un graphique, depuis le clic, sans changer aucune valeur. */
  function ripple(group: Element, x: number, y: number, side: Side): void {
    const rgb = side === "left" ? "61 127 255" : "255 43 63";
    for (const el of group.querySelectorAll<HTMLElement>("[data-ripple]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const distance = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      const scale = el.dataset.ripple === "scale" ? 1.16 : 1;
      el.animate(
        [
          { scale: 1, filter: "brightness(1)", boxShadow: `0 0 0 0 rgb(${rgb} / 0)` },
          { scale, filter: "brightness(1.6)", boxShadow: `0 0 0 2px rgb(${rgb} / 1)`, offset: 0.4 },
          { scale: 1, filter: "brightness(1)", boxShadow: `0 0 0 0 rgb(${rgb} / 0)` },
        ],
        { duration: 520, delay: distance * 0.8, easing: "ease-out" },
      );
    }
  }

  /* ---------- Curseur ---------- */

  const pointer = { x: 0, y: 0, prevX: 0, prevY: 0, seen: false, moved: false, down: false, target: null as Element | null };
  const tilts = new Map<HTMLElement, Tilt>();
  let tiltTarget: HTMLElement | null = null;
  let spotTarget: HTMLElement | null = null;
  let magnetTarget: HTMLElement | null = null;
  let tipTarget: Element | null = null;
  let crossCell: Element | null = null;
  let crossCells: Element[] = [];
  let crossTable: Element | null = null;
  const auroraPos = { x: 0, y: 0, ready: false };

  function tiltFor(el: HTMLElement, perspective: number): Tilt {
    let tilt = tilts.get(el);
    if (!tilt) {
      tilt = { el, rx: 0, ry: 0, scale: 1, targetRx: 0, targetRy: 0, targetScale: 1, perspective };
      tilts.set(el, tilt);
    }
    return tilt;
  }

  function releaseTilt(el: HTMLElement | null): void {
    const tilt = el && tilts.get(el);
    if (tilt) {
      tilt.targetRx = 0;
      tilt.targetRy = 0;
      tilt.targetScale = 1;
    }
  }

  function clearSpot(): void {
    spotTarget?.style.removeProperty("--spot");
    spotTarget = null;
  }

  function clearMagnet(): void {
    if (magnetTarget) magnetTarget.style.translate = "";
    magnetTarget = null;
  }

  function hideTip(): void {
    tip.hidden = true;
    tipTarget = null;
  }

  function clearCross(): void {
    for (const cell of crossCells) cell.classList.remove("fx-cross");
    crossTable?.classList.remove("fx-crosshair");
    crossCells = [];
    crossTable = null;
    crossCell = null;
  }

  function onPointerFrame(): void {
    const { x, y, target } = pointer;

    // Traînée de cases allumées.
    for (const [px, py] of segment(pointer.prevX, pointer.prevY, x, y, TILE_SIZE)) {
      for (const t of brush(grid, px, py, TILE_SIZE * 3)) {
        light(t.index, BLUE, t.strength * (pointer.down ? 0.75 : 0.38));
      }
    }
    pointer.prevX = x;
    pointer.prevY = y;

    // Halo sous le curseur, dans les blocs.
    const spot = target?.closest<HTMLElement>(BLOCKS) ?? null;
    if (spot !== spotTarget) {
      clearSpot();
      spotTarget = spot;
    }
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${x - r.left}px`);
      spot.style.setProperty("--my", `${y - r.top}px`);
      spot.style.setProperty("--spot", "1");
    }

    // Inclinaison 3D du bloc survolé.
    const tiltEl = target?.closest<HTMLElement>(tiltSelector) ?? null;
    if (tiltEl !== tiltTarget) {
      releaseTilt(tiltTarget);
      tiltTarget = tiltEl;
    }
    if (tiltEl) {
      const r = tiltEl.getBoundingClientRect();
      const max = Number(tiltEl.dataset.tilt ?? (tiltEl.classList.contains("stage") ? STAGE_TILT : CARD_TILT));
      const tilt = tiltFor(tiltEl, 1200);
      tilt.targetRx = -((y - r.top) / r.height - 0.5) * max * 2;
      tilt.targetRy = ((x - r.left) / r.width - 0.5) * max * 2;
    }

    // Boutons légèrement attirés par le curseur.
    const magnet = target?.closest<HTMLElement>(".btn") ?? null;
    if (magnet !== magnetTarget) {
      clearMagnet();
      magnetTarget = magnet;
    }
    if (magnet) {
      const r = magnet.getBoundingClientRect();
      const pull = (d: number) => Math.max(-6, Math.min(6, d * 0.12));
      magnet.style.translate = `${pull(x - (r.left + r.width / 2))}px ${pull(y - (r.top + r.height / 2))}px`;
    }

    // Le logo suit le curseur à travers toute la page.
    for (const logo of document.querySelectorAll<HTMLElement>("[data-fx-logo]")) {
      const r = logo.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > height) continue;
      const nx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (width / 2)));
      const ny = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / (height / 2)));
      const tilt = tiltFor(logo, 900);
      tilt.targetRx = -ny * 10;
      tilt.targetRy = nx * 14;
      const glow = logo.closest(".fx-stage")?.querySelector<HTMLElement>(".hero-glow");
      if (glow) glow.style.translate = `${nx * 28}px ${ny * 28}px`;
    }

    // Réticule sur la heatmap : le jour et l'heure de la case survolée.
    const heat = target?.closest<HTMLTableCellElement>("td.heat-cell") ?? null;
    if (heat !== crossCell) {
      clearCross();
      const table = heat?.closest("table");
      if (heat && table) {
        const row = heat.parentElement as HTMLTableRowElement;
        crossCell = heat;
        crossTable = table;
        crossCells = [...row.cells, ...[...table.rows].flatMap((r) => r.cells[heat.cellIndex] ?? [])];
        for (const cell of crossCells) cell.classList.add("fx-cross");
        table.classList.add("fx-crosshair");
      }
    }

    // Infobulle qui suit le curseur.
    const tipEl = target?.closest("[data-tip]") ?? null;
    if (tipEl !== tipTarget) {
      tipTarget = tipEl;
      tip.hidden = !tipEl;
      if (tipEl) tip.textContent = tipEl.getAttribute("data-tip");
    }
    if (tipEl) {
      const left = Math.min(width - tip.offsetWidth - 12, x + 16);
      const top = y - tip.offsetHeight - 14;
      tip.style.transform = `translate(${Math.max(8, left)}px, ${top < 8 ? y + 20 : top}px)`;
    }
  }

  function updateTilts(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    for (const tilt of tilts.values()) {
      tilt.rx += (tilt.targetRx - tilt.rx) * k;
      tilt.ry += (tilt.targetRy - tilt.ry) * k;
      tilt.scale += (tilt.targetScale - tilt.scale) * k;
      const settled = Math.abs(tilt.rx) < 0.01 && Math.abs(tilt.ry) < 0.01 && Math.abs(tilt.scale - 1) < 0.0005;
      if (settled && tilt.targetRx === 0 && tilt.targetRy === 0 && tilt.targetScale === 1) {
        tilt.el.style.transform = "";
        tilts.delete(tilt.el);
        continue;
      }
      tilt.el.style.transform = `perspective(${tilt.perspective}px) rotateX(${tilt.rx.toFixed(3)}deg) rotateY(${tilt.ry.toFixed(3)}deg) scale(${tilt.scale.toFixed(4)})`;
    }
  }

  function updateAurora(dt: number): void {
    if (!pointer.seen) return;
    const k = 1 - Math.exp(-dt * 3);
    if (!auroraPos.ready) {
      auroraPos.x = pointer.x;
      auroraPos.y = pointer.y;
      auroraPos.ready = true;
    }
    auroraPos.x += (pointer.x - auroraPos.x) * k;
    auroraPos.y += (pointer.y - auroraPos.y) * k;
    aurora.style.transform = `translate3d(${auroraPos.x.toFixed(1)}px, ${auroraPos.y.toFixed(1)}px, 0)`;
  }

  /* ---------- Défilement : barre de progression et léger relief ---------- */

  let scrollDirty = true;
  function updateScroll(): void {
    if (!scrollDirty) return;
    scrollDirty = false;
    const y = window.scrollY;
    const max = root.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    for (const stage of document.querySelectorAll<HTMLElement>(".fx-stage")) {
      stage.style.translate = `0 ${(Math.min(y, 900) * 0.08).toFixed(1)}px`;
    }
  }

  /* ---------- Boucle d'animation ---------- */

  let raf = 0;
  let last = 0;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    // L'horodatage d'une image peut précéder de peu le dernier relevé : jamais de durée négative.
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    resize();
    updateScroll();
    if (pointer.moved) {
      onPointerFrame();
      pointer.moved = false;
    }
    updateAmbient(now);
    updateWaves(now);
    updateConquests(now);
    updateTraces(now);
    drawTiles(dt);
    drawOverlay(now, dt);
    updateTilts(dt);
    updateAurora(dt);
  }

  function start(): void {
    if (raf || !enabled || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------- Écouteurs ---------- */

  const hasSelection = () => {
    const selection = getSelection();
    return Boolean(selection && !selection.isCollapsed);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!enabled || e.pointerType !== "mouse") return;
      if (!pointer.seen) {
        pointer.prevX = e.clientX;
        pointer.prevY = e.clientY;
      }
      pointer.seen = true;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.target = e.target instanceof Element ? e.target : null;
      pointer.moved = true;
    },
    { passive: true },
  );

  window.addEventListener(
    "scroll",
    () => {
      scrollDirty = true;
    },
    { passive: true },
  );

  root.addEventListener("pointerleave", () => {
    releaseTilt(tiltTarget);
    tiltTarget = null;
    clearSpot();
    clearMagnet();
    hideTip();
    clearCross();
  });

  window.addEventListener("pointerdown", (e) => {
    if (!enabled || e.pointerType !== "mouse") return;
    pointer.down = true;
    if (tiltTarget) tiltFor(tiltTarget, 1200).targetScale = 0.992;
  });
  window.addEventListener("pointerup", () => {
    pointer.down = false;
    if (tiltTarget) {
      const tilt = tilts.get(tiltTarget);
      if (tilt) tilt.targetScale = 1;
    }
  });

  function press(e: MouseEvent, side: Side): void {
    const target = e.target instanceof Element ? e.target : null;
    const logo = target?.closest<HTMLElement>("[data-fx-logo]");
    burst(e.clientX, e.clientY, side, Boolean(logo));
    const block = target?.closest<HTMLElement>(BLOCKS);
    if (block) launchLocal(block, e.clientX, e.clientY, side);
    const group = target?.closest("[data-ripple-group]");
    if (group) ripple(group, e.clientX, e.clientY, side);
    if (logo && side === "left") {
      logo.animate([{ scale: 1 }, { scale: 1.1 }, { scale: 0.96 }, { scale: 1 }], { duration: 520, easing: "ease-out" });
    } else if (logo) {
      logo.animate([{ rotate: "y 0deg" }, { rotate: "y 360deg" }], { duration: 900, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" });
    }
  }

  window.addEventListener("click", (e) => {
    // `detail === 0` : activation au clavier, sans position de curseur.
    if (!enabled || e.detail === 0 || hasSelection()) return;
    if (e.target instanceof Element && e.target.closest(NO_WAVE)) return;
    press(e, "left");
  });

  window.addEventListener("contextmenu", (e) => {
    // Maj + clic droit, le clavier et le tactile gardent le menu habituel.
    if (!enabled || e.shiftKey || e.button !== 2 || hasSelection()) return;
    if ("pointerType" in e && e.pointerType === "touch") return;
    if (e.target instanceof Element && e.target.closest(NATIVE_MENU)) return;
    e.preventDefault();
    press(e, "right");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  /* ---------- Titres mot à mot, au moment où ils arrivent à l'écran ---------- */

  const titleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      titleObserver.unobserve(entry.target);
      entry.target.classList.remove("fx-title-wait");
    }
  });

  for (const heading of document.querySelectorAll<HTMLElement>("main h1, main h2.section-title")) {
    if (heading.closest("astro-island")) continue;
    let i = 0;
    const fragment = document.createDocumentFragment();
    (heading.textContent ?? "").split(/(\s+)/).forEach((part) => {
      if (!part.trim()) {
        fragment.append(part);
        return;
      }
      const word = document.createElement("span");
      word.className = "fx-word";
      word.style.setProperty("--i", String(i++));
      word.textContent = part;
      fragment.append(word);
    });
    heading.replaceChildren(fragment);
    heading.classList.add("fx-title-wait");
    titleObserver.observe(heading);
  }

  /* ---------- Apparition des blocs ---------- */

  const hiddenBlocks = new Set<HTMLElement>();
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        revealObserver.unobserve(el);
        hiddenBlocks.delete(el);
        if (el.offsetHeight > CONQUEST_MAX_HEIGHT) {
          el.classList.add("fx-in");
          el.classList.remove("fx-hidden");
        } else {
          queueConquest(el, performance.now());
        }
      }
    },
    { rootMargin: "0px 0px -6% 0px" },
  );

  function revealAll(): void {
    for (const el of hiddenBlocks) {
      revealObserver.unobserve(el);
      el.classList.remove("fx-hidden");
    }
    hiddenBlocks.clear();
    for (const c of conquests) {
      c.el.style.clipPath = "";
      c.el.classList.remove("fx-hidden");
    }
    conquests = [];
  }

  function prepareReveal(): void {
    for (const el of document.querySelectorAll<HTMLElement>(BLOCKS)) {
      if (el.getBoundingClientRect().width === 0) continue;
      el.classList.add("fx-hidden");
      hiddenBlocks.add(el);
      revealObserver.observe(el);
    }
  }

  /* ---------- Compteurs ---------- */

  const counterObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      counterObserver.unobserve(entry.target);
      runCounter(entry.target as HTMLElement);
    }
  });

  function runCounter(el: HTMLElement): void {
    const target = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals ?? 0);
    const final = el.textContent ?? "";
    if (!Number.isFinite(target)) return;
    const fmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const begin = performance.now();
    const step = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - begin) / 900));
      if (!enabled || p >= 1) {
        el.textContent = final;
        return;
      }
      el.textContent = fmt.format(target * (1 - (1 - p) ** 3));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Infobulles ---------- */

  // Hors animation, le navigateur affiche les `title` : aucune information n'est perdue.
  function useCustomTips(on: boolean): void {
    if (on) {
      for (const el of document.querySelectorAll<HTMLElement>("main td[title], main .fx-bars [title]")) {
        el.dataset.tip = el.title;
        el.removeAttribute("title");
      }
    } else {
      for (const el of document.querySelectorAll<HTMLElement>("[data-tip]")) {
        el.title = el.dataset.tip ?? "";
        el.removeAttribute("data-tip");
      }
    }
  }

  /* ---------- Bouton pause ---------- */

  const toggle = document.querySelector<HTMLButtonElement>("[data-fx-toggle]");

  function syncToggle(): void {
    if (!toggle) return;
    toggle.hidden = false;
    toggle.setAttribute("aria-pressed", String(!enabled));
    toggle.title = enabled ? "Mettre les animations en pause" : "Relancer les animations";
  }

  function clearEffects(): void {
    tileCtx?.clearRect(0, 0, width, height);
    sparkCtx?.clearRect(0, 0, width, height);
    levels.fill(0);
    owners.fill(0);
    isHot.fill(0);
    hot = [];
    waves = [];
    sparks = [];
    rings = [];
    flashes = [];
    locals = [];
    tilesDrawn = false;
    sparksDrawn = false;
    for (const tilt of tilts.values()) tilt.el.style.transform = "";
    tilts.clear();
    tiltTarget = null;
    clearSpot();
    clearMagnet();
    hideTip();
    clearCross();
    for (const glow of document.querySelectorAll<HTMLElement>(".hero-glow")) glow.style.translate = "";
    for (const stage of document.querySelectorAll<HTMLElement>(".fx-stage")) stage.style.translate = "";
    revealAll();
  }

  function setEnabled(on: boolean, remember: boolean): void {
    enabled = on;
    root.classList.toggle("fx-off", !on);
    if (remember) storePreference(on);
    syncToggle();
    useCustomTips(on);
    if (on) {
      scrollDirty = true;
      start();
    } else {
      stop();
      clearEffects();
    }
  }

  toggle?.addEventListener("click", () => setEnabled(!enabled, true));
  syncToggle();

  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    if (e.matches) setEnabled(false, false);
  });

  /* ---------- Démarrage ---------- */

  for (const hint of document.querySelectorAll<HTMLElement>("[data-fx-hint]")) hint.hidden = !finePointer;
  resize();
  for (const el of document.querySelectorAll<HTMLElement>("[data-count]")) {
    if (el.dataset.count) counterObserver.observe(el);
  }
  for (const el of document.querySelectorAll<HTMLElement>(BLOCKS)) visibilityObserver.observe(el);
  useCustomTips(enabled);
  if (enabled) prepareReveal();
  root.classList.remove("fx-wait");
  start();

  // Sur l'accueil, une première conquête montre l'effet avant tout clic.
  if (document.querySelector("[data-fx-hint]")) {
    window.setTimeout(() => {
      if (!enabled) return;
      launchWave(0, height * 0.62, BLUE, width * 0.4, 520, 0.75);
      launchWave(width, height * 0.62, RED, width * 0.4, 520, 0.75);
    }, 450);
  }
  root.classList.add("fx-ready");
}

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) init();
