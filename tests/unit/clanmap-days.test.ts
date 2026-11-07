import { describe, expect, it } from "vitest";
import { changeSinceLastDay, dayHighlights, dayRows, filmDayMarks, parisDayOf, placeDayLabels, territoryReadings, territorySeries, type DayData, type DayRow } from "../../src/lib/clanmap/days";
import { findMoments } from "../../src/lib/clanmap/moments";
import { fmtEpochDay, fmtEpochHour, fmtEpochTime } from "../../src/lib/format";
import { StoredClanMapFilm } from "../../src/lib/schemas";

const seconds = (iso: string) => Date.parse(iso) / 1000;
const day = (date: string, taken: number, lost: number, frame = 1, pixels = 100): DayData => ({ date, frame, pixels, rank: 3, taken, lost });

describe("dates à Paris", () => {
  it("écrit le jour et l'heure de Paris, en hiver comme en été", () => {
    // 23 h 30 UTC : déjà le lendemain à Paris.
    expect(parisDayOf(seconds("2026-11-03T23:30:00Z"))).toBe("2026-11-04");
    expect(fmtEpochDay(seconds("2026-11-03T23:30:00Z"))).toBe("4 nov.");
    expect(fmtEpochHour(seconds("2026-11-03T23:30:00Z"))).toBe("4 nov., 0 h");
    expect(fmtEpochHour(seconds("2026-07-14T16:10:00Z"))).toBe("14 juil., 18 h");
    expect(fmtEpochTime(seconds("2026-11-07T15:49:22Z"))).toBe("16:49");
  });
});

describe("journées affichées", () => {
  const frames = [{ gal: 0 }, { gal: 0 }, { gal: 5 }, { gal: 9 }];

  it("calcule le solde et l'image d'où rejouer chaque journée", () => {
    const rows = dayRows([day("2026-11-03", 10, 4, 3), day("2026-11-04", 2, 7, 4)], frames, "2026-11-05T10:00:00.000Z");
    expect(rows.map((r) => [r.net, r.start])).toEqual([[6, 2], [-5, 3]]);
  });

  it("repart juste avant le premier pixel pour rejouer la première journée", () => {
    expect(dayRows([day("2026-11-03", 1, 0, 3)], frames, "2026-11-05T10:00:00.000Z")[0]?.start).toBe(2);
    expect(dayRows([day("2026-11-03", 1, 0, 1)], [{ gal: 1 }], "2026-11-05T10:00:00.000Z")[0]?.start).toBe(0);
  });

  it("une journée n'est terminée qu'une fois passée à Paris", () => {
    const rows = [day("2026-11-03", 1, 0), day("2026-11-04", 1, 0)];
    expect(dayRows(rows, frames, "2026-11-04T22:59:00.000Z").map((r) => r.complete)).toEqual([true, false]);
    // Minuit est déjà passé à Paris, pas encore en temps universel.
    expect(dayRows(rows, frames, "2026-11-04T23:01:00.000Z").map((r) => r.complete)).toEqual([true, true]);
  });

  it("un film sans journées n'a aucune ligne", () => {
    expect(dayRows([], frames, "2026-11-05T10:00:00.000Z")).toEqual([]);
  });
});

describe("territoire jour après jour", () => {
  const row = (date: string, pixels: number, complete = true): DayRow => ({ ...day(date, 1, 0, 1, pixels), net: 1, start: 0, complete });

  it("suit les journées terminées, sans celle en cours", () => {
    expect(territorySeries([row("2026-11-03", 10), row("2026-11-04", 20), row("2026-11-05", 99, false)])).toEqual([
      { date: "2026-11-03", value: 10 },
      { date: "2026-11-04", value: 20 },
    ]);
  });

  it("laisse un trou pour un jour sans aucun événement : le temps ne se resserre pas", () => {
    expect(territorySeries([row("2026-11-03", 10), row("2026-11-05", 20)])).toEqual([
      { date: "2026-11-03", value: 10 },
      { date: "2026-11-04", value: null },
      { date: "2026-11-05", value: 20 },
    ]);
  });

  it("reste vide sans journée terminée", () => {
    expect(territorySeries([])).toEqual([]);
    expect(territorySeries([row("2026-11-05", 99, false)])).toEqual([]);
  });

  it("mesure l'évolution depuis la fin de la dernière journée terminée", () => {
    expect(changeSinceLastDay([row("2026-11-05", 100), row("2026-11-06", 150), row("2026-11-07", 170, false)], 170)).toEqual({ date: "2026-11-06", change: 20 });
    expect(changeSinceLastDay([row("2026-11-06", 150)], 120)).toEqual({ date: "2026-11-06", change: -30 });
    expect(changeSinceLastDay([row("2026-11-07", 170, false)], 170)).toBeNull();
    expect(changeSinceLastDay([], 170)).toBeNull();
  });
});

describe("records de journées", () => {
  const row = (date: string, net: number, complete = true): DayRow => ({ ...day(date, Math.max(net, 0), Math.max(-net, 0)), net, start: 0, complete });

  it("garde le plus fort gain et le plus fort recul", () => {
    const { gain, loss } = dayHighlights([row("2026-11-01", 5), row("2026-11-02", 50), row("2026-11-03", -8), row("2026-11-04", -30), row("2026-11-05", 7)]);
    expect(gain?.date).toBe("2026-11-02");
    expect(loss?.date).toBe("2026-11-04");
  });

  it("ne donne pas de record à la journée pas terminée, qui pourrait encore le démentir", () => {
    const { gain, loss } = dayHighlights([row("2026-11-01", 5), row("2026-11-02", 500, false), row("2026-11-03", -500, false)]);
    expect(gain?.date).toBe("2026-11-01");
    expect(loss).toBeNull();
  });

  it("sans journée positive, pas de meilleur jour ; sans journée négative, pas de pire jour", () => {
    expect(dayHighlights([row("2026-11-01", -5), row("2026-11-02", 0)]).gain).toBeNull();
    expect(dayHighlights([row("2026-11-01", 5), row("2026-11-02", 0)]).loss).toBeNull();
    expect(dayHighlights([])).toEqual({ gain: null, loss: null });
  });

  it("à égalité, la première journée garde le record", () => {
    expect(dayHighlights([row("2026-11-01", 9), row("2026-11-02", 9)]).gain?.date).toBe("2026-11-01");
  });
});

describe("repères de la frise", () => {
  it("marque où commence chaque jour de Paris", () => {
    const frames = [
      { at: seconds("2026-11-03T10:00:00Z") },
      { at: seconds("2026-11-03T22:59:00Z") },
      { at: seconds("2026-11-03T23:01:00Z") },
      { at: seconds("2026-11-05T09:00:00Z") },
    ];
    expect(filmDayMarks(frames)).toEqual([
      { frame: 0, date: "2026-11-03" },
      { frame: 2, date: "2026-11-04" },
      { frame: 3, date: "2026-11-05" },
    ]);
  });

  it("un film sans dates n'a aucun repère", () => {
    expect(filmDayMarks([{}, {}])).toEqual([]);
  });

  const marks = Array.from({ length: 12 }, (_, i) => ({ frame: (i + 1) * 30 }));

  it("écrit les dates sans chevauchement ni débordement, à toutes les largeurs", () => {
    for (const width of [56, 100, 300, 640, 1200, 1800]) {
      const placed = placeDayLabels(marks, 360, width, 56);
      expect(placed.length).toBeGreaterThan(0);
      placed.forEach(({ left }, i) => {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + 56).toBeLessThanOrEqual(width);
        if (i > 0) expect(left).toBeGreaterThanOrEqual(placed[i - 1]!.left + 56);
      });
    }
  });

  it("garde toujours le dernier jour, et écrit tout s'il y a la place", () => {
    expect(placeDayLabels(marks, 360, 300, 56).at(-1)?.mark).toBe(marks.at(-1));
    expect(placeDayLabels(marks, 360, 1800, 56)).toHaveLength(12);
  });

  it("n'écrit rien sans place ni image", () => {
    expect(placeDayLabels(marks, 360, 0, 56)).toEqual([]);
    expect(placeDayLabels(marks, 0, 300, 56)).toEqual([]);
    expect(placeDayLabels([], 360, 300, 56)).toEqual([]);
  });

  it("centre une date sur son jour quand elle ne touche pas un bord", () => {
    const [placed] = placeDayLabels([{ frame: 50 }], 100, 400, 40);
    expect(placed?.left).toBe(180);
  });
});

describe("relevés du territoire pour la gazette", () => {
  const row = (date: string, pixels: number, complete: boolean): DayRow => ({ ...day(date, 1, 0, 1, pixels), net: 1, start: 0, complete });
  const journal = [
    { date: "2026-11-05", pixels: 500, rank: 3, caps: null, troops: null },
    { date: "2026-11-06", pixels: 600, rank: 3, caps: null, troops: null },
  ];

  it("préfère la fin de journée de l'historique, et remonte avant le premier relevé", () => {
    const readings = territoryReadings([row("2026-11-04", 400, true), row("2026-11-05", 510, true)], journal);
    expect(readings.map((r) => [r.date, r.pixels])).toEqual([["2026-11-04", 400], ["2026-11-05", 510], ["2026-11-06", 600]]);
  });

  it("garde le relevé du jour plutôt qu'une journée pas terminée", () => {
    const readings = territoryReadings([row("2026-11-06", 999, false)], journal);
    expect(readings.map((r) => [r.date, r.pixels])).toEqual([["2026-11-05", 500], ["2026-11-06", 600]]);
  });

  it("sans film daté, ne garde que les relevés", () => {
    expect(territoryReadings([], journal)).toEqual(journal);
  });
});

describe("film d'avant les dates", () => {
  const film = {
    version: 3,
    fetchedAt: "2026-11-05T10:00:00.000Z",
    seq: 1,
    events: 1,
    width: 2,
    height: 2,
    scale: 2,
    cols: 1,
    rows: 1,
    bucket: 5000,
    totalChanges: 1,
    land: 4,
    claimed: 1,
    check: { events: 1, mismatches: 0 },
    clans: [{ tag: null, color: null }],
    gal: 1,
    galSummary: { pixels: 1, rank: 1, firstEvent: 1, peak: { pixels: 1, event: 1 }, taken: 1, lost: 0, neutralTaken: 1, fronts: [], zones: [], zoneCount: 1, neutralBorder: null },
    standings: [],
    treasury: null,
    frames: [{ ev: 1, total: 1, clans: 1, gal: 1, rank: 1, top: [], cam: null }],
  };

  it("reste lisible jusqu'au passage suivant de la collecte, sans aucune date inventée", () => {
    const parsed = StoredClanMapFilm.parse(film);
    expect(parsed.frames[0]?.at).toBeUndefined();
    expect(parsed.galSummary?.firstAt).toBeUndefined();
    expect(parsed.galSummary?.peak.at).toBeUndefined();
    expect(parsed.days).toBeUndefined();
    expect(filmDayMarks(parsed.frames)).toEqual([]);
    expect(dayRows(parsed.days ?? [], parsed.frames, parsed.fetchedAt)).toEqual([]);
    expect(findMoments(parsed.frames)[0]?.at).toBeNull();
  });
});
