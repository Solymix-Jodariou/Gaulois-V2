import { describe, expect, it } from "vitest";
import { clanRgb, decodeFrames, encodeFrames } from "../../src/lib/clanmap/codec";
import { FRAME_BASE, FRAME_MAX, analyzeTerritory, bucketSize, replayHistory, type EventLog } from "../../src/lib/clanmap/replay";
import { OFFICIAL_MAP, blendOwners, countLand } from "../../src/lib/clanmap/terrain";

const WIDTH = 8;
const HEIGHT = 4;
const options = { width: WIDTH, height: HEIGHT, scale: 2, galId: 43 };

/** Une date en secondes Unix. */
const seconds = (iso: string) => Date.parse(iso) / 1000;
const START = seconds("2026-11-02T12:00:00Z");

/** Événements écrits [x, y, clan], numérotés à partir de 1, avec leur vrai ancien propriétaire. Sans dates données : une seconde entre chacun. */
function logOf(events: [number, number, number][], firstSeq = 1, dates?: number[]): EventLog {
  const owners = new Map<number, number>();
  const previous = events.map(([x, y, clan]) => {
    const pixel = y * WIDTH + x;
    const before = owners.get(pixel) ?? 0;
    owners.set(pixel, clan);
    return before;
  });
  return {
    length: events.length,
    seq: Uint32Array.from(events.map((_, i) => firstSeq + i)),
    x: Uint16Array.from(events.map((e) => e[0])),
    y: Uint16Array.from(events.map((e) => e[1])),
    clan: Uint32Array.from(events.map((e) => e[2])),
    previous: Uint32Array.from(previous),
    at: Uint32Array.from(events.map((_, i) => dates?.[i] ?? START + i)),
  };
}

/** Rejoue les images du film pour vérifier ce que verra le navigateur. */
function finalCells(deltas: number[][], cols: number, rows: number): Uint16Array {
  const decoded = decodeFrames(encodeFrames(deltas), deltas.length, deltas.reduce((n, d) => n + d.length / 2, 0));
  const cells = new Uint16Array(cols * rows);
  for (let i = 0; i < decoded.cells.length; i++) cells[decoded.cells[i]!] = decoded.owners[i]!;
  return cells;
}

describe("format du film", () => {
  it("retrouve exactement ce qui a été encodé", () => {
    const deltas = [[0, 1, 5, 2, 300, 60000], [], [2, 0, 123456, 3]];
    const decoded = decodeFrames(encodeFrames(deltas), 3, 5);
    expect([...decoded.offsets]).toEqual([0, 3, 3, 5]);
    expect([...decoded.cells]).toEqual([0, 5, 300, 2, 123456]);
    expect([...decoded.owners]).toEqual([1, 2, 60000, 0, 3]);
  });

  it("refuse un film tronqué ou de la mauvaise longueur", () => {
    const bytes = encodeFrames([[1, 1, 2, 2]]);
    expect(() => decodeFrames(bytes.slice(0, -1), 1, 2)).toThrow("tronqué");
    expect(() => decodeFrames(bytes, 1, 1)).toThrow();
    expect(() => decodeFrames(bytes, 1, 3)).toThrow("incohérent");
  });

  it("donne du gris à un clan sans couleur, jamais une couleur inventée", () => {
    expect(clanRgb(0x38bdf8)).toEqual([0x38, 0xbd, 0xf8]);
    expect(clanRgb(null)).toEqual([130, 135, 150]);
  });
});

describe("découpage du film", () => {
  it("garde la même taille d'image tant que le film reste court", () => {
    expect(bucketSize(1)).toBe(FRAME_BASE);
    expect(bucketSize(FRAME_BASE * FRAME_MAX)).toBe(FRAME_BASE);
    expect(bucketSize(FRAME_BASE * FRAME_MAX + 1)).toBe(FRAME_BASE * 2);
  });

  it("borne toujours le nombre d'images", () => {
    for (const events of [1_641_811, 5_000_000, 90_000_000]) {
      expect(Math.ceil(events / bucketSize(events))).toBeLessThanOrEqual(FRAME_MAX);
    }
  });

  it("ne réécrit pas les images déjà calculées quand l'historique grandit", () => {
    const events: [number, number, number][] = [];
    for (let i = 0; i < FRAME_BASE * 2 + 40; i++) events.push([i % WIDTH, (i >> 3) % HEIGHT, i % 7 === 0 ? 43 : 9]);
    const shorter = replayHistory(logOf(events.slice(0, FRAME_BASE + 20)), options);
    const longer = replayHistory(logOf(events), options);
    expect(longer.deltas[0]).toEqual(shorter.deltas[0]);
    expect(longer.frames[0]).toEqual(shorter.frames[0]);
  });
});

describe("dates du film", () => {
  it("donne à chaque image la date de son dernier événement", () => {
    const events: [number, number, number][] = [];
    for (let i = 0; i < FRAME_BASE + 3; i++) events.push([i % WIDTH, (i >> 3) % HEIGHT, 9]);
    const { frames } = replayHistory(logOf(events), options);
    expect(frames.map((f) => f.at)).toEqual([START + FRAME_BASE - 1, START + FRAME_BASE + 2]);
  });

  it("ne fait pas reculer le temps si une date recule de quelques secondes", () => {
    const { frames } = replayHistory(logOf([[0, 0, 9], [1, 0, 9]], 1, [START + 10, START + 3]), options);
    expect(frames[0]?.at).toBe(START + 10);
  });

  it("date le premier pixel et le record de GAL", () => {
    const dates = [START, START + 100, START + 200, START + 300];
    const { galSummary } = replayHistory(logOf([[0, 0, 9], [1, 0, 43], [2, 0, 43], [1, 0, 9]], 1, dates), options);
    expect(galSummary).toMatchObject({ firstEvent: 2, firstAt: START + 100, peak: { pixels: 2, event: 3, at: START + 200 } });
  });
});

describe("journées de GAL", () => {
  it("coupe les journées à minuit à Paris, en hiver comme en été", () => {
    const winter = replayHistory(
      logOf([[0, 0, 43], [1, 0, 43]], 1, [seconds("2026-11-03T22:59:59Z"), seconds("2026-11-03T23:00:00Z")]),
      options,
    );
    expect(winter.days.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04"]);
    const summer = replayHistory(
      logOf([[0, 0, 43], [1, 0, 43]], 1, [seconds("2026-07-14T21:59:59Z"), seconds("2026-07-14T22:00:00Z")]),
      options,
    );
    expect(summer.days.map((d) => d.date)).toEqual(["2026-07-14", "2026-07-15"]);
  });

  it("garde le jour où l'heure change, sans le couper en deux", () => {
    // Le 25 octobre 2026, Paris repasse à l'heure d'hiver : cette journée compte 25 heures.
    const { days } = replayHistory(
      logOf([[0, 0, 43], [1, 0, 43], [2, 0, 43]], 1, [seconds("2026-10-24T22:00:00Z"), seconds("2026-10-25T22:59:59Z"), seconds("2026-10-25T23:00:00Z")]),
      options,
    );
    expect(days.map((d) => [d.date, d.taken])).toEqual([["2026-10-25", 2], ["2026-10-26", 1]]);
  });

  it("compte chaque jour les pixels pris, perdus, le territoire et la place à la fin du jour", () => {
    const day1 = seconds("2026-11-03T12:00:00Z");
    const day2 = seconds("2026-11-04T12:00:00Z");
    const { days } = replayHistory(
      logOf(
        [
          [0, 0, 9],
          [1, 0, 9],
          [2, 0, 43], // GAL arrive, 2e derrière le clan 9.
          [3, 0, 43],
          [4, 0, 43], // GAL passe devant.
          [2, 0, 9], // Le lendemain, le clan 9 lui reprend un pixel.
          [3, 0, 9],
          [5, 0, 43],
        ],
        1,
        [day1, day1, day1, day1, day1, day2, day2, day2],
      ),
      options,
    );
    expect(days).toEqual([
      { date: "2026-11-03", frame: 1, pixels: 3, rank: 1, taken: 3, lost: 0 },
      { date: "2026-11-04", frame: 2, pixels: 2, rank: 2, taken: 1, lost: 2 },
    ]);
  });

  it("commence au premier pixel de GAL, et garde les jours où il ne se passe rien pour lui", () => {
    const day = (n: number) => seconds(`2026-11-0${n}T12:00:00Z`);
    const { days } = replayHistory(logOf([[0, 0, 9], [1, 0, 43], [2, 0, 9]], 1, [day(1), day(2), day(3)]), options);
    expect(days).toEqual([
      { date: "2026-11-02", frame: 2, pixels: 1, rank: 2, taken: 1, lost: 0 },
      { date: "2026-11-03", frame: 3, pixels: 1, rank: 2, taken: 0, lost: 0 },
    ]);
  });

  it("ne compte pas un pixel repeint par son propre propriétaire", () => {
    const { days } = replayHistory(logOf([[0, 0, 43], [0, 0, 43]]), options);
    // Le deuxième événement annonce un ancien propriétaire qui reste GAL : rien ne change.
    expect(days[0]).toMatchObject({ taken: 1, lost: 0, pixels: 1 });
  });

  it("retombe sur les totaux de GAL, quel que soit le découpage", () => {
    const events: [number, number, number][] = [];
    const dates: number[] = [];
    for (let i = 0; i < 700; i++) {
      events.push([i % WIDTH, (i * 3) % HEIGHT, i % 3 === 0 ? 43 : i % 3 === 1 ? 9 : 7]);
      dates.push(START + i * 1_000);
    }
    const { days, galSummary } = replayHistory(logOf(events, 1, dates), options);
    expect(days.length).toBeGreaterThan(5);
    expect(days.reduce((n, d) => n + d.taken, 0)).toBe(galSummary?.taken);
    expect(days.reduce((n, d) => n + d.lost, 0)).toBe(galSummary?.lost);
    expect(days.at(-1)?.pixels).toBe(galSummary?.pixels);
    let pixels = 0;
    for (const day of days) {
      pixels += day.taken - day.lost;
      expect(day.pixels).toBe(pixels);
    }
  });

  it("n'ajoute pas d'image quand minuit tombe entre deux images", () => {
    const events: [number, number, number][] = [];
    const dates: number[] = [];
    for (let i = 0; i < FRAME_BASE * 2 + 10; i++) {
      events.push([i % WIDTH, (i >> 3) % HEIGHT, i % 2 === 0 ? 43 : 9]);
      // Le deuxième jour commence au tout début de la deuxième image.
      dates.push(i < FRAME_BASE ? seconds("2026-11-03T12:00:00Z") : seconds("2026-11-04T12:00:00Z"));
    }
    const { days, frames } = replayHistory(logOf(events, 1, dates), options);
    expect(frames).toHaveLength(3);
    expect(days.map((d) => d.frame)).toEqual([1, 3]);
  });

  it("ferme une image à minuit : le film s'arrête sur la fin exacte du jour, avec les chiffres du tableau", () => {
    const events: [number, number, number][] = [];
    const dates: number[] = [];
    for (let i = 0; i < FRAME_BASE + 10; i++) {
      events.push([i % WIDTH, (i >> 3) % HEIGHT, i % 3 === 0 ? 43 : i % 3 === 1 ? 9 : 7]);
      dates.push(i < 100 ? seconds("2026-11-03T22:59:00Z") : seconds("2026-11-03T23:01:00Z"));
    }
    const { days, frames } = replayHistory(logOf(events, 1, dates), options);
    // 100 événements le premier jour, puis les images reprennent leur découpage habituel.
    expect(frames.map((f) => f.ev)).toEqual([100, FRAME_BASE, FRAME_BASE + 10]);
    expect(days.map((d) => d.frame)).toEqual([1, 3]);
    expect(frames.map((f) => f.at)).toEqual([dates[0], dates[100], dates[100]]);
    for (const day of days) {
      expect(frames[day.frame - 1]).toMatchObject({ gal: day.pixels, rank: day.rank });
    }
  });

  it("ne réécrit pas les images déjà calculées quand l'historique grandit, minuits compris", () => {
    const events: [number, number, number][] = [];
    const dates: number[] = [];
    for (let i = 0; i < FRAME_BASE * 2 + 40; i++) {
      events.push([i % WIDTH, (i >> 3) % HEIGHT, i % 7 === 0 ? 43 : 9]);
      dates.push(START + i * 30);
    }
    const cut = FRAME_BASE + 20;
    const shorter = replayHistory(logOf(events.slice(0, cut), 1, dates.slice(0, cut)), options);
    const longer = replayHistory(logOf(events, 1, dates), options);
    expect(shorter.days.length).toBeGreaterThan(1);
    // Seule la dernière image, encore incomplète, peut changer.
    const kept = shorter.frames.length - 1;
    expect(longer.frames.slice(0, kept)).toEqual(shorter.frames.slice(0, kept));
    expect(longer.deltas.slice(0, kept)).toEqual(shorter.deltas.slice(0, kept));
  });

  it("n'a aucune journée si GAL n'est pas sur la carte", () => {
    expect(replayHistory(logOf([[0, 0, 9]]), options).days).toEqual([]);
    expect(replayHistory(logOf([[0, 0, 43]]), { ...options, galId: null }).days).toEqual([]);
  });
});

describe("rejeu de l'historique", () => {
  it("compte les pixels de chaque clan et les échanges de GAL", () => {
    const result = replayHistory(
      logOf([
        [0, 0, 9], // Le clan 9 prend une terre neutre.
        [1, 0, 43], // Premier pixel de GAL, sur une terre neutre.
        [0, 0, 43], // GAL prend un pixel au clan 9.
        [2, 0, 43],
        [2, 0, 9], // Le clan 9 reprend un pixel à GAL.
        [3, 0, 7],
        [3, 0, 0], // Le clan 7 rend son pixel : retour à neutre.
      ]),
      options,
    );
    const at = (id: number) => result.pixels[result.clanIds.indexOf(id)];
    expect(at(43)).toBe(2);
    expect(at(9)).toBe(1);
    expect(at(7)).toBe(0);
    expect(result.galSummary).toMatchObject({
      pixels: 2,
      rank: 1,
      firstEvent: 2,
      peak: { pixels: 3, event: 4 },
      taken: 3,
      lost: 1,
      neutralTaken: 2,
    });
    const nine = result.clanIds.indexOf(9);
    expect(result.galSummary?.fronts).toEqual([{ clan: nine, taken: 1, lost: 1 }]);
  });

  it("n'attribue aucun rang à GAL tant qu'il n'a pas de pixel", () => {
    const result = replayHistory(logOf([[0, 0, 9]]), options);
    expect(result.gal).toBeNull();
    expect(result.galSummary).toBeNull();
    expect(result.frames[0]).toMatchObject({ gal: 0, rank: null, cam: null, clans: 1 });
  });

  it("classe les clans par pixels et note GAL quand il sort du top", () => {
    const events: [number, number, number][] = [];
    let i = 0;
    for (const [clan, n] of [[1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [43, 2]] as const) {
      for (let k = 0; k < n; k++, i++) events.push([i % WIDTH, Math.floor(i / WIDTH), clan]);
    }
    const frame = replayHistory(logOf(events), options).frames[0];
    expect(frame?.top).toHaveLength(5);
    expect(frame?.top[0]?.[1]).toBe(7);
    expect(frame?.rank).toBe(6);
    expect(frame?.gal).toBe(2);
    expect(frame?.total).toBe(27);
  });

  it("le film reconstruit le territoire à échelle réduite", () => {
    const result = replayHistory(
      logOf([
        [0, 0, 43],
        [1, 0, 43],
        [0, 1, 43],
        [6, 2, 9],
        [7, 2, 9],
        [6, 3, 9],
      ]),
      options,
    );
    expect(result.cols).toBe(4);
    expect(result.rows).toBe(2);
    const cells = finalCells(result.deltas, result.cols, result.rows);
    expect(cells[0]).toBe(result.clanIds.indexOf(43));
    expect(cells[7]).toBe(result.clanIds.indexOf(9));
    expect(cells[3]).toBe(0);
    // La caméra se centre sur GAL, seule case occupée.
    expect(result.frames[0]?.cam).toEqual([0, 0, 0, 0]);
  });

  it("ne garde pas de case à un clan qui l'a perdue dans la même image", () => {
    const result = replayHistory(
      logOf([
        [0, 0, 43],
        [1, 0, 43],
        [0, 0, 9],
        [1, 0, 9],
      ]),
      options,
    );
    const cells = finalCells(result.deltas, result.cols, result.rows);
    expect(cells[0]).toBe(result.clanIds.indexOf(9));
    expect(result.frames[0]?.cam).toBeNull();
  });

  it("note la position exacte du dernier événement dans l'image finale", () => {
    const result = replayHistory(logOf([[0, 0, 43], [1, 0, 43], [2, 0, 43]]), options);
    expect(result.frames.at(-1)?.ev).toBe(3);
    expect(result.frames).toHaveLength(1);
  });
});

describe("contrôle avec l'ancien propriétaire annoncé", () => {
  const events: [number, number, number][] = [
    [0, 0, 43],
    [1, 0, 9],
    [2, 0, 43],
    [2, 0, 9],
    [2, 0, 0], // Le clan 9 rend ce pixel : le propriétaire annoncé est bien le clan 9.
  ];

  it("ne trouve aucun écart quand l'historique est complet", () => {
    expect(replayHistory(logOf(events), options).check).toEqual({ events: 5, mismatches: 0 });
  });

  it("compte chaque événement qui contredit le rejeu", () => {
    const log = logOf(events);
    log.previous[3] = 9; // Ce pixel appartenait à GAL.
    log.previous[4] = 43; // Celui-ci au clan 9.
    expect(replayHistory(log, options).check.mismatches).toBe(2);
  });

  it("repère un événement manquant dès que son pixel rechange de main", () => {
    const log = logOf(events);
    const without = (values: Uint16Array | Uint32Array, i: number) => values.filter((_, k) => k !== i);
    const holed: EventLog = {
      length: log.length - 1,
      seq: without(log.seq, 2) as Uint32Array,
      x: without(log.x, 2) as Uint16Array,
      y: without(log.y, 2) as Uint16Array,
      clan: without(log.clan, 2) as Uint32Array,
      previous: without(log.previous, 2) as Uint32Array,
      at: without(log.at, 2) as Uint32Array,
    };
    expect(replayHistory(holed, options).check.mismatches).toBe(1);
  });

  it("accepte qu'un clan repeigne son propre pixel", () => {
    const repainted = replayHistory(logOf([[0, 0, 43], [0, 0, 43]]), options);
    expect(repainted.check.mismatches).toBe(0);
    expect(repainted.galSummary?.pixels).toBe(1);
  });
});

describe("analyse du territoire", () => {
  // Carte 300 × 300, sans mer : le clan 1 possède deux zones, le clan 2 touche la plus grande.
  const W = 300;
  const makeGrid = () => new Uint16Array(W * W);
  const land = new Uint8Array(W * W).fill(128);
  const put = (grid: Uint16Array, x0: number, y0: number, x1: number, y1: number, clan: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * W + x] = clan;
  };

  it("sépare les zones d'un seul tenant, de la plus grande à la plus petite", () => {
    const grid = makeGrid();
    put(grid, 10, 10, 19, 19, 1);
    put(grid, 100, 100, 101, 101, 1);
    const result = analyzeTerritory(grid, W, W, 2, 1, land);
    expect(result.zoneCount).toBe(2);
    expect(result.zones.map((z) => z.pixels)).toEqual([100, 4]);
    expect(result.zones[0]).toMatchObject({ x: 7, y: 7, halfWidth: 3, halfHeight: 3 });
  });

  it("ne garde que les plus grandes zones, mais les compte toutes", () => {
    const grid = makeGrid();
    for (let i = 0; i < 8; i++) put(grid, i * 10, 0, i * 10, 0, 1);
    const result = analyzeTerritory(grid, W, W, 2, 1, land);
    expect(result.zoneCount).toBe(8);
    expect(result.zones).toHaveLength(5);
  });

  it("compte une seule fois un pixel voisin touché des deux côtés", () => {
    const grid = makeGrid();
    put(grid, 10, 10, 10, 10, 1);
    put(grid, 12, 10, 12, 10, 1);
    put(grid, 11, 10, 11, 10, 2);
    expect(analyzeTerritory(grid, W, W, 2, 1, land).borders.get(2)?.pixels).toBe(1);
  });

  it("compte une seule fois un pixel neutre touché des deux côtés", () => {
    const grid = makeGrid();
    put(grid, 10, 10, 10, 10, 1);
    put(grid, 12, 10, 12, 10, 1);
    // Le pixel (11, 10) touche les deux. Chaque pixel a 4 voisins, soit 7 pixels neutres distincts.
    expect(analyzeTerritory(grid, W, W, 2, 1, land).neutralBorder).toBe(7);
  });

  it("ne compte pas la mer comme une terre à prendre", () => {
    const grid = makeGrid();
    put(grid, 10, 10, 10, 10, 1);
    expect(analyzeTerritory(grid, W, W, 2, 1, new Uint8Array(W * W)).neutralBorder).toBe(0);
  });

  it("sans terrain, ne donne aucun chiffre plutôt qu'un zéro, et garde le reste", () => {
    const grid = makeGrid();
    put(grid, 10, 10, 11, 10, 1);
    const result = analyzeTerritory(grid, W, W, 2, 1, null);
    expect(result.neutralBorder).toBeNull();
    expect(result.zoneCount).toBe(1);
  });

  it("vise la plus grosse portion d'une frontière, pas la moyenne de ses morceaux", () => {
    const grid = makeGrid();
    // Deux contacts éloignés avec le clan 2 : un de 20 pixels à gauche, un de 2 pixels à droite.
    put(grid, 10, 10, 29, 10, 1);
    put(grid, 10, 11, 29, 11, 2);
    put(grid, 280, 200, 281, 200, 1);
    put(grid, 280, 201, 281, 201, 2);
    const border = analyzeTerritory(grid, W, W, 2, 1, land).borders.get(2);
    expect(border?.pixels).toBe(22);
    // Le centre reste sur le grand morceau, en cases réduites de moitié.
    expect(border?.x).toBeLessThan(20);
    expect(border?.y).toBeLessThan(10);
  });
});

describe("carte officielle", () => {
  it("garde la taille documentée par OpenFront et la surface du manifeste de la carte", () => {
    expect(OFFICIAL_MAP).toEqual({ width: 4108, height: 1948, land: 2_335_403 });
  });

  it("compte les terres", () => {
    expect(countLand(Uint8Array.from([128, 128 + 31, 0, 31, 128]))).toBe(3);
  });

  it("ne teinte que les cases occupées", () => {
    const background = Uint8Array.from([10, 10, 10, 20, 20, 20]);
    const out = blendOwners(background, Uint16Array.from([0, 1]), [null, [120, 0, 0]]);
    expect([...out.slice(0, 3)]).toEqual([10, 10, 10]);
    expect(out[3]).toBe(105);
    expect(out[4]).toBe(3);
  });
});
