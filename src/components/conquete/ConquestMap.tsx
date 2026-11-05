import { useEffect, useMemo, useRef } from "preact/hooks";
import { hexPath } from "../../lib/conquete/geo";
import type { GameMap, TerritoryState } from "../../lib/conquete/types";
import { playerColor } from "../../lib/conquete/feed";

const MIN_ZOOM = 1;
const MAX_ZOOM = 9;
/** Au-delà, les noms deviennent lisibles et s'affichent. */
const NAMES_ZOOM = 3.2;
const TAP_DISTANCE = 8;

interface Props {
  map: GameMap;
  states: ReadonlyMap<number, TerritoryState>;
  selected: number | null;
  /** Les territoires sur lesquels le joueur peut agir. */
  targets: ReadonlySet<number>;
  me: number | null;
  /** Le texte du survol. */
  describe: (id: number) => string;
  onSelect: (id: number) => void;
}

/**
 * La carte : un dessin, pas la seule façon de jouer. Tout ce qu'elle permet se fait aussi
 * depuis la liste des territoires, au clavier. Le déplacement et le zoom ne repassent pas
 * par Preact : seul le groupe bouge, et la carte reste fluide sur téléphone.
 */
export default function ConquestMap({ map, states, selected, targets, me, describe, onSelect }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });
  /** Le territoire qu'on vient de toucher sur la carte : inutile de la déplacer sous le doigt du joueur. */
  const tapped = useRef<number | null>(null);

  const { minX, minY, maxX, maxY } = map.bounds;
  const width = maxX - minX;
  const height = maxY - minY;

  const shapes = useMemo(() => map.territories.map((t) => ({ t, d: hexPath(t.x, t.y, map.hexSize * 0.97) })), [map]);
  const relief = useMemo(() => {
    const mark = (x: number, y: number, s: number) => `M${x - s} ${y + s * 0.5}L${x} ${y - s * 0.6}L${x + s} ${y + s * 0.5}`;
    let hills = "";
    let peaks = "";
    for (const t of map.territories) {
      if (t.terrain === "highland") hills += mark(t.x, t.y, 1.2);
      if (t.terrain === "mountain") peaks += mark(t.x - 1.1, t.y + 0.3, 1.25) + mark(t.x + 1.1, t.y + 0.3, 1.25);
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

  const apply = () => {
    const { k, x, y } = view.current;
    group.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    if (svg.current) {
      svg.current.dataset["zoomed"] = String(k > 1.01);
      svg.current.dataset["names"] = String(k >= NAMES_ZOOM);
    }
  };

  const clamp = () => {
    const v = view.current;
    v.k = Math.min(Math.max(v.k, MIN_ZOOM), MAX_ZOOM);
    v.x = Math.min(Math.max(v.x, maxX - maxX * v.k), minX - minX * v.k);
    v.y = Math.min(Math.max(v.y, maxY - maxY * v.k), minY - minY * v.k);
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
    apply();
  };

  /** Amène un territoire choisi depuis la liste dans la vue. */
  useEffect(() => {
    if (selected === null || tapped.current === selected) return;
    const t = map.territories[selected - 1];
    if (!t) return;
    const v = view.current;
    if (v.k < 2.2) v.k = 2.2;
    v.x = minX + width / 2 - t.x * v.k;
    v.y = minY + height / 2 - t.y * v.k;
    clamp();
    apply();
    // Ne recentre que lorsque le choix change : le joueur garde la main sur le déplacement.
  }, [selected, map]);

  useEffect(() => {
    apply();
    const node = svg.current;
    if (!node) return;
    // Sans Ctrl, la molette continue de faire défiler la page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { x, y } = toMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // Les bornes ne changent pas pour une même carte.
  }, [map]);

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
  };

  const onPointerMove = (e: PointerEvent) => {
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
    const wasTap = pointers.current.size === 1 && gesture.current.moved < TAP_DISTANCE && pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!wasTap) return;
    const id = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest<SVGElement>("[data-t]")?.dataset["t"];
    if (id) {
      tapped.current = Number(id);
      onSelect(Number(id));
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
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
      <div class="conq-map-view" tabIndex={0} role="group" aria-label="Carte des territoires. Flèches pour se déplacer, plus et moins pour zoomer. Tous les territoires sont aussi dans la liste juste en dessous." onKeyDown={onKeyDown}>
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
            <g class="conq-routes">
              {routes.map((d) => (
                <path key={d} d={d}></path>
              ))}
            </g>
            {shapes.map(({ t, d }) => {
              const state = states.get(t.id);
              const mine = state !== undefined && state.owner === me;
              const isProtected = state?.protected_until ? Date.parse(state.protected_until) > Date.now() : false;
              return (
                <path
                  key={t.id}
                  data-t={t.id}
                  d={d}
                  class={["conq-hex", !state && "is-free", mine && "is-mine", targets.has(t.id) && "is-target", selected === t.id && "is-selected", isProtected && "is-protected"].filter(Boolean).join(" ")}
                  style={state ? { fill: playerColor(state.owner) } : undefined}
                ></path>
              );
            })}
            <path class="conq-relief" d={relief.hills}></path>
            <path class="conq-relief" d={relief.peaks}></path>
            <g class="conq-names" aria-hidden="true">
              {map.territories.map((t) => (
                <text key={t.id} x={t.x} y={t.y + 3.2}>
                  {t.name.length > 16 ? `${t.name.slice(0, 15)}…` : t.name}
                </text>
              ))}
            </g>
          </g>
        </svg>
        <div ref={tip} class="conq-tip" hidden></div>
      </div>
      <div class="conq-map-tools">
        <button type="button" class="chip" onClick={() => zoomCentre(1.4)} aria-label="Zoomer">
          +
        </button>
        <button type="button" class="chip" onClick={() => zoomCentre(1 / 1.4)} aria-label="Dézoomer">
          −
        </button>
        <button type="button" class="chip" onClick={reset}>
          Vue d'ensemble
        </button>
        <span class="text-xs text-muted">Glisser pour se déplacer. Ctrl + molette ou deux doigts pour zoomer.</span>
      </div>
    </div>
  );
}
