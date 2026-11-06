import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { basePath } from "../../lib/conquete/api";
import { playerBorder, playerColor } from "../../lib/conquete/feed";
import { WORLD_VIEW, hexPath } from "../../lib/conquete/geo";
import { BUILDINGS } from "../../lib/conquete/rules";
import { labelFontSize, outlinesOf, ownerLabels, ownerLayers, shortName } from "../../lib/conquete/shapes";
import type { GameMap, TerritoryState } from "../../lib/conquete/types";
import { fmtDec1, fmtInt } from "../../lib/format";

const MIN_ZOOM = 1;
const MAX_ZOOM = 9;
/** Au-delà, les noms des territoires deviennent lisibles et s'affichent. */
const NAMES_ZOOM = 3.2;
/** Au-delà, les petits repères du relief s'affichent : la vue d'ensemble reste nette. */
const MARKS_ZOOM = 1.7;
/** Sous cette largeur à l'écran, en pixels, la grille des hexagones ne ferait que griser le relief. */
const GRID_MIN_HEX_PX = 11;
/** Une étiquette plus petite que ça ne se lirait pas : elle attend qu'on zoome. */
const LABEL_MIN_PX = 9;
/** Et plus grande, elle cacherait la carte : elle cesse de grandir avec le zoom. */
const LABEL_MAX_PX = 30;
const TAP_DISTANCE = 8;
/** La finesse de l'image légère, en pixels par unité de la carte : au-delà, la version complète prend le relais. */
const LIGHT_RELIEF_PX_PER_UNIT = 3.3;
/** Le premier affichage se décide sur la largeur de la fenêtre : les petits écrans n'ont que l'image légère à charger. */
const FULL_RELIEF_WINDOW_PX = 1200;
/** Une terre prise depuis moins longtemps que ça pulse : on voit la carte bouger. */
const FRESH_MS = 15 * 60_000;
/** En dessous, c'est un téléphone ou une petite tablette : les panneaux passent sous la carte. */
const SMALL_SCREEN_PX = 960;
const HOME_ZOOM = 2.4;
/** Sur l'écran de jeu, des panneaux couvrent les bords : la carte peut glisser un peu plus loin pour qu'aucune terre n'y reste coincée. */
const ARENA_OVERSCROLL = 0.4;
/** Où poser une terre qu'on va chercher, en part de la hauteur : au-dessus de la barre de commande. */
const FOCUS_HEIGHT = 0.38;
/** Et au-dessus du guide, s'il est ouvert. */
const FOCUS_HEIGHT_GUIDED = 0.27;

interface Props {
  map: GameMap;
  states: ReadonlyMap<number, TerritoryState>;
  selected: number | null;
  /** Les territoires sur lesquels le joueur peut agir. */
  targets: ReadonlySet<number>;
  me: number | null;
  /** Le nom affiché sur les terres d'un joueur. */
  nameOf: (owner: number) => string;
  /** Le texte du survol. */
  describe: (id: number) => string;
  onSelect: (id: number) => void;
  /** Change à chaque demande de « trouver » un territoire, même s'il est déjà choisi : la carte y retourne. */
  focus?: number;
  /** Mes alliés et les traîtres du moment, par numéro de joueur. */
  allies?: ReadonlySet<number>;
  traitors?: ReadonlySet<number>;
  /** Les terres que le guide conseille en ce moment. */
  suggested?: ReadonlySet<number>;
  /** Ma terre principale : sur un petit écran, la carte s'ouvre dessus, sinon rien n'est assez grand pour être touché. */
  home?: number | null;
  /** Le guide est ouvert en bas de la carte : la terre visée se pose plus haut, pour ne pas être dessous. */
  guided?: boolean;
  /** La carte occupe tout l'écran : la molette zoome, sans Ctrl. */
  arena?: boolean;
  /** Ce qui se pose par-dessus la carte : l'annonce d'un don, par exemple. */
  children?: ComponentChildren;
}

/**
 * La carte : un dessin, pas la seule façon de jouer. Tout ce qu'elle permet se fait aussi
 * depuis la liste des territoires, au clavier. Le déplacement et le zoom ne repassent pas
 * par Preact : seul le groupe bouge, et la carte reste fluide sur téléphone.
 */
export default function ConquestMap({ map, states, selected, targets, me, nameOf, describe, onSelect, focus = 0, allies, traitors, suggested, home = null, guided = false, arena = false, children }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  const relief = useRef<SVGImageElement>(null);
  const labelsGroup = useRef<SVGGElement>(null);
  const zoomValue = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });
  /** Le territoire qu'on vient de toucher sur la carte : inutile de la déplacer sous le doigt du joueur. */
  const tapped = useRef<number | null>(null);
  const lastFocus = useRef(focus);
  const sharp = useRef(false);
  const openedOnHome = useRef(false);

  const { minX, minY, maxX, maxY } = map.bounds;
  const width = maxX - minX;
  const height = maxY - minY;

  const reliefFile = (small: boolean) => `${basePath()}/conquete/terrain-${map.version}${small ? "-small" : ""}.webp`;
  const firstRelief = useMemo(() => reliefFile(window.innerWidth * window.devicePixelRatio < FULL_RELIEF_WINDOW_PX), [map]);

  const hexes = useMemo(() => map.territories.map((t) => ({ t, d: hexPath(t.x, t.y, map.hexSize) })), [map]);
  const grid = useMemo(() => map.territories.map((t) => t.shape).join(""), [map]);
  const marks = useMemo(() => {
    const mark = (x: number, y: number, s: number) => `M${x - s} ${y + s * 0.5}L${x} ${y - s * 0.6}L${x + s} ${y + s * 0.5}`;
    let hills = "";
    let peaks = "";
    for (const t of map.territories) {
      if (t.terrain === "highland") hills += mark(t.x, t.y - 2.6, 0.95);
      if (t.terrain === "mountain") peaks += mark(t.x - 0.9, t.y - 2.5, 0.95) + mark(t.x + 0.9, t.y - 2.5, 0.95);
    }
    return { hills, peaks };
  }, [map]);
  const routes = useMemo(() => {
    const byId = new Map(map.territories.map((t) => [t.id, t]));
    return map.routes.map((r) => {
      const a = byId.get(r.a)!;
      const b = byId.get(r.b)!;
      // Béring : la route passe par les bords de la carte, sans traverser le monde.
      if (r.wrap) {
        return `M${a.x} ${a.y}L${minX} ${a.y}M${b.x} ${b.y}L${maxX} ${b.y}`;
      }
      return `M${a.x} ${a.y}L${b.x} ${b.y}`;
    });
  }, [map, minX, maxX]);

  const layers = useMemo(() => ownerLayers(outlinesOf(map), states), [map, states]);
  const labels = useMemo(
    () =>
      ownerLabels(map, states).map((label) => {
        const name = nameOf(label.owner);
        return { ...label, name: shortName(name), size: labelFontSize(name, label) };
      }),
    [map, states, nameOf],
  );

  /** Pixels à l'écran pour une unité de la carte, sans zoom. */
  const screenScale = () => {
    const rect = svg.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.min(rect.width / width, rect.height / height) : 1;
  };

  /** Ce qui dépend du niveau de zoom : changé seulement quand il change, pas à chaque image d'un déplacement. */
  const applyDetail = () => {
    const node = svg.current;
    if (!node) return;
    const { k } = view.current;
    const scale = screenScale() * k;
    node.dataset["names"] = String(k >= NAMES_ZOOM);
    node.dataset["marks"] = String(k >= MARKS_ZOOM);
    node.dataset["grid"] = String(Math.sqrt(3) * map.hexSize * scale >= GRID_MIN_HEX_PX);
    for (const label of labelsGroup.current?.children ?? []) {
      const px = Number(label.getAttribute("data-size")) * scale;
      (label as SVGElement).style.display = px >= LABEL_MIN_PX ? "" : "none";
      const x = label.getAttribute("data-x");
      const y = label.getAttribute("data-y");
      const shrink = LABEL_MAX_PX / px;
      if (shrink < 1) label.setAttribute("transform", `translate(${x} ${y}) scale(${shrink}) translate(${-Number(x)} ${-Number(y)})`);
      else label.removeAttribute("transform");
    }
    if (zoomValue.current) zoomValue.current.textContent = `×${fmtDec1(k)}`;
    // On zoome, ou l'écran est plus grand que prévu : l'image complète arrive, chargée avant d'être montrée.
    if (!sharp.current && relief.current?.getAttribute("href")?.endsWith("-small.webp") && scale * window.devicePixelRatio > LIGHT_RELIEF_PX_PER_UNIT) {
      sharp.current = true;
      const image = new Image();
      image.onload = () => relief.current?.setAttribute("href", image.src);
      image.src = reliefFile(false);
    }
  };

  const apply = (zoomChanged = true) => {
    const { k, x, y } = view.current;
    group.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    if (svg.current) svg.current.dataset["zoomed"] = String(k > 1.01);
    if (zoomChanged) applyDetail();
  };

  const clamp = () => {
    const v = view.current;
    v.k = Math.min(Math.max(v.k, MIN_ZOOM), MAX_ZOOM);
    const padX = arena && v.k > 1.01 ? width * ARENA_OVERSCROLL : 0;
    const padY = arena && v.k > 1.01 ? height * ARENA_OVERSCROLL : 0;
    v.x = Math.min(Math.max(v.x, maxX - maxX * v.k - padX), minX - minX * v.k + padX);
    v.y = Math.min(Math.max(v.y, maxY - maxY * v.k - padY), minY - minY * v.k + padY);
  };

  /** Convertit une position à l'écran en coordonnées de la carte. */
  const toMap = (clientX: number, clientY: number) => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.max(width / rect.width, height / rect.height);
    const offsetX = (rect.width * scale - width) / 2;
    const offsetY = (rect.height * scale - height) / 2;
    return { x: (clientX - rect.left) * scale + minX - offsetX, y: (clientY - rect.top) * scale + minY - offsetY, scale };
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const v = view.current;
    const k = Math.min(Math.max(v.k * factor, MIN_ZOOM), MAX_ZOOM);
    v.x = cx - ((cx - v.x) * k) / v.k;
    v.y = cy - ((cy - v.y) * k) / v.k;
    v.k = k;
    clamp();
    apply();
  };

  const zoomCentre = (factor: number) => zoomAt(factor, minX + width / 2, minY + height / 2);
  const reset = () => {
    view.current = { k: 1, x: 0, y: 0 };
    apply();
  };
  const panBy = (dx: number, dy: number) => {
    view.current.x += dx;
    view.current.y += dy;
    clamp();
    apply(false);
  };

  /** Amène un territoire choisi depuis la liste dans la vue. */
  useEffect(() => {
    const asked = focus !== lastFocus.current;
    lastFocus.current = focus;
    if (selected === null || (tapped.current === selected && !asked)) return;
    const t = map.territories[selected - 1];
    if (!t) return;
    const v = view.current;
    if (v.k < 2.2) v.k = 2.2;
    // Sur grand écran, les panneaux se posent sur la carte : la terre visée va là où on la voit.
    const onScreen = arena && window.innerWidth >= SMALL_SCREEN_PX ? (guided ? FOCUS_HEIGHT_GUIDED : FOCUS_HEIGHT) : 0.5;
    v.x = minX + width / 2 - t.x * v.k;
    v.y = minY + height * onScreen - t.y * v.k;
    clamp();
    apply();
    // Ne recentre que lorsque le choix change, ou sur demande : le joueur garde la main sur le déplacement.
  }, [selected, focus, map]);

  /** Sur un petit écran, le monde entier ne laisse rien à toucher : la carte s'ouvre sur les terres du joueur. */
  useEffect(() => {
    if (openedOnHome.current || home === null || !arena || selected !== null || window.innerWidth >= SMALL_SCREEN_PX) return;
    const t = map.territories[home - 1];
    if (!t) return;
    openedOnHome.current = true;
    const v = view.current;
    v.k = HOME_ZOOM;
    v.x = minX + width / 2 - t.x * v.k;
    v.y = minY + height / 2 - t.y * v.k;
    clamp();
    apply();
  }, [home, map, arena]);

  useEffect(() => {
    apply();
    const node = svg.current;
    if (!node) return;
    // Hors de l'écran de jeu, sans Ctrl, la molette continue de faire défiler la page.
    const onWheel = (e: WheelEvent) => {
      if (!arena && !e.ctrlKey && !e.metaKey) return;
      // La carte est déjà au plus large : la molette rend la main à la page, vers le fil et les classements.
      if (view.current.k <= MIN_ZOOM && !e.ctrlKey && !e.metaKey && (e.deltaY > 0 || window.scrollY > 0)) return;
      e.preventDefault();
      const { x, y } = toMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    const resized = new ResizeObserver(() => applyDetail());
    resized.observe(node);
    return () => {
      node.removeEventListener("wheel", onWheel);
      resized.disconnect();
    };
    // Les bornes ne changent pas pour une même carte.
  }, [map, arena]);

  /** De nouvelles étiquettes : on leur applique le niveau de zoom en cours. */
  useEffect(() => {
    applyDetail();
  }, [labels]);

  const showTip = (e: PointerEvent) => {
    const node = tip.current;
    if (!node) return;
    const id = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest<SVGElement>("[data-t]")?.dataset["t"];
    if (e.pointerType !== "mouse" || !id) {
      node.hidden = true;
      return;
    }
    node.textContent = describe(Number(id));
    node.hidden = false;
    const bounds = node.parentElement!.getBoundingClientRect();
    node.style.left = `${Math.min(e.clientX - bounds.left + 14, bounds.width - node.offsetWidth - 8)}px`;
    node.style.top = `${e.clientY - bounds.top + 14}px`;
  };

  const onPointerDown = (e: PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { moved: 0, pinch: 0 };
    // Le geste nous appartient jusqu'au bout, même relâché au-dessus d'un panneau ou hors de la fenêtre.
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      // Sans capture, le contrôle du bouton ci-dessous termine le geste.
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    // Une souris sans bouton enfoncé ne déplace jamais la carte, quoi qu'il se soit passé avant.
    if (e.pointerType === "mouse" && e.buttons === 0) pointers.current.delete(e.pointerId);
    const previous = pointers.current.get(e.pointerId);
    if (!previous) {
      showTip(e);
      return;
    }
    const all = [...pointers.current.values()];
    if (all.length === 2) {
      const other = all.find((p) => p !== previous)!;
      const distance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (gesture.current.pinch > 0) {
        const { x, y } = toMap((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        zoomAt(distance / gesture.current.pinch, x, y);
      }
      gesture.current.pinch = distance;
      gesture.current.moved = TAP_DISTANCE + 1;
    } else if (all.length === 1 && view.current.k > 1.01) {
      const { scale } = toMap(e.clientX, e.clientY);
      panBy((e.clientX - previous.x) * scale, (e.clientY - previous.y) * scale);
      gesture.current.moved += Math.hypot(e.clientX - previous.x, e.clientY - previous.y);
    } else {
      gesture.current.moved += Math.hypot(e.clientX - previous.x, e.clientY - previous.y);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: PointerEvent) => {
    const wasTap = e.type === "pointerup" && pointers.current.size === 1 && gesture.current.moved < TAP_DISTANCE && pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!wasTap) return;
    const id = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest<SVGElement>("[data-t]")?.dataset["t"];
    if (id) {
      tapped.current = Number(id);
      onSelect(Number(id));
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Les flèches restent à la réglette et aux champs posés sur la carte.
    if ((e.target as Element | null)?.closest?.("input, select, textarea, button, a, summary")) return;
    const step = (width / 12) * 1;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, step),
      ArrowDown: () => panBy(0, -step),
      "+": () => zoomCentre(1.3),
      "=": () => zoomCentre(1.3),
      "-": () => zoomCentre(1 / 1.3),
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div class="conq-map" data-testid="conquest-map">
      <div class="conq-map-view" tabIndex={0} role="group" aria-label="Carte des territoires. Flèches pour se déplacer, plus et moins pour zoomer. Tous les territoires sont aussi dans la liste sous la carte." onKeyDown={onKeyDown}>
        <div class="conq-map-stage">
        <svg
          ref={svg}
          viewBox={`${minX} ${minY} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Carte du monde découpée en territoires, à la couleur de leur propriétaire."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            if (tip.current) tip.current.hidden = true;
          }}
        >
          <g ref={group}>
            <path class="conq-land" d={map.land}></path>
            <image
              ref={relief}
              class="conq-terrain"
              href={firstRelief}
              x={WORLD_VIEW.minX}
              y={WORLD_VIEW.minY}
              width={WORLD_VIEW.maxX - WORLD_VIEW.minX}
              height={WORLD_VIEW.maxY - WORLD_VIEW.minY}
              preserveAspectRatio="none"
            />
            <path class="conq-grid" d={grid}></path>
            <g class="conq-routes">
              {routes.map((d) => (
                <path key={d} d={d}></path>
              ))}
            </g>
            <g class="conq-owners">
              {layers.map((layer) => (
                <path key={layer.owner} class="conq-owner" data-owner={layer.owner} d={layer.fill} style={{ fill: playerColor(layer.owner) }}></path>
              ))}
            </g>
            <g class="conq-borders">
              {layers.map((layer) => (
                <path key={layer.owner} class={layer.owner === me ? "is-mine" : undefined} d={layer.border} style={layer.owner === me ? undefined : { stroke: playerBorder(layer.owner) }}></path>
              ))}
            </g>
            <path class="conq-relief" d={marks.hills}></path>
            <path class="conq-relief" d={marks.peaks}></path>
            {hexes.map(({ t, d }) => {
              const state = states.get(t.id);
              const mine = state !== undefined && state.owner === me;
              const isProtected = state?.protected_until ? Date.parse(state.protected_until) > Date.now() : false;
              const isFresh = state?.taken_at ? Date.now() - Date.parse(state.taken_at) < FRESH_MS : false;
              const isAlly = state !== undefined && (allies?.has(state.owner) ?? false);
              const isSuggested = suggested?.has(t.id) ?? false;
              return (
                <path
                  key={t.id}
                  data-t={t.id}
                  data-owner={state?.owner}
                  d={d}
                  class={["conq-hex", !state && "is-free", mine && "is-mine", targets.has(t.id) && "is-target", selected === t.id && "is-selected", isProtected && "is-protected", isAlly && "is-ally", isFresh && "is-fresh", isSuggested && "is-suggested"].filter(Boolean).join(" ")}
                ></path>
              );
            })}
            <g class="conq-names" aria-hidden="true">
              {map.territories.map((t) => (
                <text key={t.id} x={t.x} y={t.y + 3.2}>
                  {t.name.length > 16 ? `${t.name.slice(0, 15)}…` : t.name}
                </text>
              ))}
            </g>
            <g ref={labelsGroup} class="conq-labels" aria-hidden="true" data-testid="owner-labels">
              {labels.map((label) => (
                <g key={label.owner} class={traitors?.has(label.owner) ? "is-traitor" : undefined} data-size={label.size} data-x={label.x} data-y={label.y} data-owner={label.owner}>
                  <text x={label.x} y={label.y - label.size * 0.08} font-size={label.size}>
                    {label.name}
                  </text>
                  <text class="conq-label-troops" x={label.x} y={label.y + label.size * 0.86} font-size={label.size * 0.82}>
                    {fmtInt(label.garrison)}
                  </text>
                </g>
              ))}
            </g>
            <g class="conq-buildings" aria-hidden="true" data-testid="map-buildings">
              {hexes.map(({ t }) => {
                const kind = states.get(t.id)?.building;
                if (!kind) return null;
                return (
                  <g key={t.id} class={`conq-building is-${kind}`}>
                    <rect x={t.x - 1.05} y={t.y - 1.05} width={2.1} height={2.1} rx={0.45} />
                    <text x={t.x} y={t.y + 0.58}>
                      {BUILDINGS[kind].mark}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        <div ref={tip} class="conq-tip" hidden></div>
        <div class="conq-map-tools">
          <button type="button" class="conq-tool" onClick={() => zoomCentre(1 / 1.4)} aria-label="Dézoomer">
            −
          </button>
          <span ref={zoomValue} class="conq-zoom tnum" aria-hidden="true">
            ×1
          </span>
          <button type="button" class="conq-tool" onClick={() => zoomCentre(1.4)} aria-label="Zoomer">
            +
          </button>
          <button type="button" class="conq-tool conq-tool-wide" onClick={reset}>
            Monde<span class="sr-only"> : vue d'ensemble</span>
          </button>
        </div>
        </div>
        {children}
      </div>
      {!arena && <p class="mt-2 text-xs text-muted">Glisser pour se déplacer. Ctrl + molette ou deux doigts pour zoomer. Le nombre sous un nom : ses troupes en garnison.</p>}
    </div>
  );
}
