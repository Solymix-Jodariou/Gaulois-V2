import { describe, expect, it } from "vitest";
import { fmtPoints } from "../../src/lib/format";
import { arrivalsGap, comparisonSentence, editionLead, endingOn, gazetteEditions, type GazetteSources, standingDetails, standingGap, standingSentence, territoryDetails, territoryGap, weekLabel } from "../../src/lib/gazette";
import type { HistorySnapshot, StoredMember, StoredSession } from "../../src/lib/schemas";
import { mondayOf } from "../../src/lib/time";

function session(gameStart: string, over: Partial<StoredSession> = {}): StoredSession {
  return { gameId: `${gameStart}${over.hasWon ?? ""}`, clanPlayerCount: 2, hasWon: true, numTeams: 2, playerTeams: "2", totalPlayerCount: 20, gameStart, score: 1, ...over };
}
function snapshot(date: string, rank: number | null = 2, over: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return { date, capturedAt: `${date}T10:00:00.000Z`, leaderboardEnd: `${date}T09:00:00.000Z`, clansListed: 100, rank, score: 100, games: 10, wins: 5, losses: 5, membersTotal: 700, ...over };
}
function member(joinedAt: string, username: string | null): StoredMember {
  return { role: "member", joinedAt, publicId: username, username, team: null };
}
// Le 7 novembre 2026 est un samedi. Le dernier dimanche définitif est le 1er : sa semaine commence le 26 octobre.
const sources = (over: Partial<GazetteSources> = {}): GazetteSources => ({ sessions: [], history: [], territory: [], members: null, archiveStart: "2026-10-12", completeThrough: "2026-11-06", ...over });

describe("mondayOf", () => {
  it("donne le lundi de la semaine, le dimanche compris, même au changement d'heure", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-07")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("gazetteEditions", () => {
  it("ne publie que des semaines complètes, de la plus récente à la plus ancienne", () => {
    expect(gazetteEditions(sources()).map((e) => [e.from, e.to])).toEqual([
      ["2026-10-26", "2026-11-01"],
      ["2026-10-19", "2026-10-25"],
      ["2026-10-12", "2026-10-18"],
    ]);
  });
  it("attend que le dimanche soit définitif pour publier sa semaine", () => {
    expect(gazetteEditions(sources({ completeThrough: "2026-11-07" }))[0]?.from).toBe("2026-10-26");
    expect(gazetteEditions(sources({ completeThrough: "2026-11-08" }))[0]?.from).toBe("2026-11-02");
    expect(gazetteEditions(sources({ completeThrough: "2026-11-09" }))[0]?.from).toBe("2026-11-02");
  });
  it("écarte la première semaine si l'archive commence en cours de semaine", () => {
    const editions = gazetteEditions(sources({ archiveStart: "2026-10-16" }));
    expect(editions.at(-1)?.from).toBe("2026-10-19");
  });
  it("ne publie rien sans journée définitive ni avant la première semaine complète", () => {
    expect(gazetteEditions(sources({ completeThrough: null }))).toEqual([]);
    expect(gazetteEditions(sources({ archiveStart: "2026-11-03" }))).toEqual([]);
  });

  describe("les parties", () => {
    it("compte les parties et les victoires de la semaine, et le taux", () => {
      const sessions = [session("2026-10-27T10:00:00.000Z"), session("2026-10-28T10:00:00.000Z"), session("2026-10-29T10:00:00.000Z", { hasWon: false }), session("2026-10-30T10:00:00.000Z", { hasWon: false })];
      expect(gazetteEditions(sources({ sessions }))[0]?.totals).toEqual({ games: 4, wins: 2, winRate: 50 });
    });
    it("range une partie selon l'heure de Paris, pas selon l'heure UTC", () => {
      // Dimanche 23 h 30 UTC : en hiver, c'est déjà lundi à Paris.
      const sessions = [session("2026-11-01T23:30:00.000Z"), session("2026-11-01T22:30:00.000Z")];
      const [latest] = gazetteEditions(sources({ sessions, completeThrough: "2026-11-08" }));
      expect(latest?.from).toBe("2026-11-02");
      expect(latest?.totals.games).toBe(1);
      expect(latest?.previous?.games).toBe(1);
    });
    it("fait de même à l'heure d'été", () => {
      // Dimanche 22 h 30 UTC : en été, c'est déjà lundi à Paris.
      const sessions = [session("2026-10-18T22:30:00.000Z"), session("2026-10-18T21:30:00.000Z")];
      const editions = gazetteEditions(sources({ sessions, archiveStart: "2026-10-05", completeThrough: "2026-10-25" }));
      expect(editions[0]?.from).toBe("2026-10-19");
      expect(editions[0]?.totals.games).toBe(1);
      expect(editions[1]?.totals.games).toBe(1);
    });
    it("donne la semaine d'avant, et rien pour la toute première semaine", () => {
      const sessions = [session("2026-10-27T10:00:00.000Z"), session("2026-10-20T10:00:00.000Z", { hasWon: false })];
      const editions = gazetteEditions(sources({ sessions }));
      expect(editions[0]?.previous).toEqual({ games: 1, wins: 0, winRate: 0 });
      expect(editions.at(-1)?.previous).toBeNull();
    });
    it("traite une semaine sans partie comme un vrai zéro, sans taux", () => {
      const [latest] = gazetteEditions(sources());
      expect(latest?.totals).toEqual({ games: 0, wins: 0, winRate: null });
      expect(latest?.highlights).toBeNull();
    });
    it("reprend les temps forts sur cette seule semaine", () => {
      const sessions = [session("2026-10-27T10:00:00.000Z"), session("2026-10-27T11:00:00.000Z"), session("2026-10-19T11:00:00.000Z", { clanPlayerCount: 30 })];
      const highlights = gazetteEditions(sources({ sessions }))[0]?.highlights;
      expect(highlights?.streak.wins).toBe(2);
      expect(highlights?.bestDay).toMatchObject({ date: "2026-10-27", wins: 2 });
      expect(highlights?.biggestGroup.players).toBe(2);
    });
  });

  describe("le classement et la carte", () => {
    it("n'invente rien pour une semaine sans relevé", () => {
      const [latest] = gazetteEditions(sources({ history: [snapshot("2026-11-05")], territory: [{ date: "2026-11-05", pixels: 10, rank: 5 }] }));
      expect(latest?.standing).toBeNull();
      expect(latest?.territory).toBeNull();
    });
    it("part du dernier relevé d'avant la semaine", () => {
      const history = [snapshot("2026-10-20", 3), snapshot("2026-10-25", 4), snapshot("2026-10-28", 3), snapshot("2026-11-01", 2)];
      const standing = gazetteEditions(sources({ history }))[0]?.standing;
      expect(standing?.start?.date).toBe("2026-10-25");
      expect(standing?.end.date).toBe("2026-11-01");
    });
    it("part du premier relevé de la semaine si rien n'existe avant, et le laisse voir", () => {
      const history = [snapshot("2026-10-29", 3), snapshot("2026-11-01", 2)];
      const standing = gazetteEditions(sources({ history }))[0]?.standing ?? null;
      expect(standing?.start?.date).toBe("2026-10-29");
      expect(standingSentence(standing, "GAL")).toBe("Au classement officiel, [GAL] est 3e le 29 oct. et 2e le 1 nov.");
    });
    it("n'a pas de point de départ avec un seul relevé", () => {
      const standing = gazetteEditions(sources({ history: [snapshot("2026-11-01")] }))[0]?.standing;
      expect(standing?.start).toBeNull();
      expect(standing?.end.date).toBe("2026-11-01");
    });
    it("accepte des relevés dans le désordre", () => {
      const history = [snapshot("2026-11-01", 2), snapshot("2026-10-28", 3)];
      expect(gazetteEditions(sources({ history }))[0]?.standing?.end.rank).toBe(2);
    });
    it("suit le territoire de la même façon", () => {
      const readings = [
        { date: "2026-10-25", pixels: 100, rank: 6, caps: null, troops: null },
        { date: "2026-11-01", pixels: 150, rank: 5, caps: null, troops: null },
      ];
      const territory = gazetteEditions(sources({ territory: readings }))[0]?.territory;
      expect(territory?.start?.pixels).toBe(100);
      expect(territory?.end.pixels).toBe(150);
    });
  });

  describe("les arrivées", () => {
    const list = (...members: StoredMember[]) => ({ fetchedAt: "2026-11-09T12:00:00.000Z", total: members.length, members });

    it("compte les arrivées de la semaine, sépare les pseudos et les anonymes, dans l'ordre d'arrivée", () => {
      const members = list(member("2026-10-29T10:00:00.000Z", "Bravo"), member("2026-10-27T10:00:00.000Z", "Alpha"), member("2026-10-28T10:00:00.000Z", null), member("2026-10-20T10:00:00.000Z", "Ancien"), member("2026-11-03T10:00:00.000Z", "Nouveau"));
      expect(gazetteEditions(sources({ members }))[0]?.arrivals).toEqual({ count: 3, named: ["Alpha", "Bravo"], anonymous: 1 });
    });
    it("n'écrit jamais d'identifiant de joueur", () => {
      const members = list({ ...member("2026-10-27T10:00:00.000Z", null), publicId: "IdSecret" });
      expect(JSON.stringify(gazetteEditions(sources({ members })))).not.toContain("IdSecret");
    });
    it("range une arrivée selon l'heure de Paris", () => {
      const members = list(member("2026-11-01T23:30:00.000Z", "Lundi"), member("2026-11-01T22:30:00.000Z", "Dimanche"));
      const [latest, before] = gazetteEditions(sources({ members, completeThrough: "2026-11-08" }));
      expect(latest?.arrivals?.named).toEqual(["Lundi"]);
      expect(before?.arrivals?.named).toEqual(["Dimanche"]);
    });
    it("n'annonce pas de zéro tant que la liste ne couvre pas toute la semaine", () => {
      const arrivalsWith = (fetchedAt: string) => gazetteEditions(sources({ members: { ...list(member("2026-10-20T10:00:00.000Z", "Premier")), fetchedAt } }))[0]?.arrivals;
      // Figée avant la semaine, ou relevée le dimanche : elle ne dit rien de définitif.
      expect(arrivalsWith("2026-10-25T10:00:00.000Z")).toBeNull();
      expect(arrivalsWith("2026-11-01T10:00:00.000Z")).toBeNull();
      // Dimanche 23 h 30 UTC : c'est déjà lundi à Paris, la semaine est finie.
      expect(arrivalsWith("2026-11-01T23:30:00.000Z")).toEqual({ count: 0, named: [], anonymous: 0 });
    });
    it("distingue une semaine sans arrivée d'une semaine où l'on ne sait pas", () => {
      const members = list(member("2026-10-20T10:00:00.000Z", "Premier"));
      const editions = gazetteEditions(sources({ members }));
      expect(editions[0]?.arrivals).toEqual({ count: 0, named: [], anonymous: 0 });
      // Avant la première arrivée connue, la liste ne dit rien.
      expect(editions.at(-1)?.arrivals).toBeNull();
      expect(gazetteEditions(sources())[0]?.arrivals).toBeNull();
    });
  });
});

describe("les phrases", () => {
  const [plain] = gazetteEditions(sources());
  if (!plain) throw new Error("édition attendue");

  it("nomme la semaine", () => {
    expect(weekLabel(plain)).toBe("du 26 oct. au 1 nov. 2026");
  });
  it("dit le classement sans commenter", () => {
    const at = (date: string, rank: number | null) => snapshot(date, rank);
    expect(standingSentence(null, "GAL")).toBeNull();
    // Deux relevés ne disent rien de ce qui s'est passé entre eux : chacun est daté, sans « reste » ni « passe ».
    expect(standingSentence({ start: at("2026-10-25", 2), end: at("2026-11-01", 2) }, "GAL")).toBe("Au classement officiel, [GAL] est 2e le 25 oct. et 2e le 1 nov.");
    expect(standingSentence({ start: at("2026-10-25", 3), end: at("2026-11-01", 1) }, "GAL")).toBe("Au classement officiel, [GAL] est 3e le 25 oct. et 1er le 1 nov.");
    expect(standingSentence({ start: at("2026-10-25", null), end: at("2026-11-01", 2) }, "GAL")).toBe("Au classement officiel, [GAL] est hors de la liste le 25 oct. et 2e le 1 nov.");
    expect(standingSentence({ start: at("2026-10-25", 2), end: at("2026-11-01", null) }, "GAL")).toBe("Au classement officiel, [GAL] est 2e le 25 oct. et hors de la liste le 1 nov.");
    expect(standingSentence({ start: null, end: at("2026-11-01", 2) }, "GAL")).toBe("[GAL] est 2e au classement officiel le 1 nov.");
    expect(standingSentence({ start: null, end: at("2026-11-01", null) }, "GAL")).toBe("[GAL] est hors de la liste officielle le 1 nov.");
  });
  it("écrit les lignes du classement, avec leurs dates", () => {
    const at = (date: string, rank: number | null, score: number | null) => snapshot(date, rank, { score });
    expect(standingDetails({ start: at("2026-10-25", 3, 1000.5), end: at("2026-11-01", 2, 1100) })).toEqual(["3e le 25 oct., 2e le 1 nov.", "Score : 1\u202f000,50, puis 1\u202f100,00."]);
    expect(standingDetails({ start: null, end: at("2026-11-01", 2, 100) })).toEqual(["Seul relevé de la semaine : le 1 nov.", "Score : 100,00."]);
    expect(standingDetails({ start: at("2026-10-25", 2, null), end: at("2026-11-01", 2, 100) })[1]).toBe("Score : 100,00.");
    expect(standingDetails({ start: at("2026-10-25", 2, 100), end: at("2026-11-01", null, null) })).toEqual(["2e le 25 oct., hors de la liste le 1 nov."]);
  });
  it("écrit les lignes du territoire, écart signé compris", () => {
    const at = (date: string, pixels: number, rank: number | null = 5) => ({ date, pixels, rank, caps: null, troops: null });
    expect(territoryDetails({ start: at("2026-11-05", 91_560), end: at("2026-11-08", 113_025) })).toEqual(["pixels le 8 nov., 5e sur la carte.", "91\u202f560 pixels le 5 nov., soit +21\u202f465."]);
    expect(territoryDetails({ start: at("2026-11-05", 200), end: at("2026-11-08", 150) })[1]).toBe("200 pixels le 5 nov., soit −50.");
    expect(territoryDetails({ start: null, end: at("2026-08-08", 150, null) })).toEqual(["pixels le 8 août."]);
  });
  it("explique une absence selon sa vraie raison", () => {
    expect(standingGap("2026-11-05", "2026-11-01")).toBe("L'API ne donne pas le passé du classement : il est relevé depuis le 5 nov.");
    expect(standingGap(null, "2026-11-01")).toBe("L'API ne donne pas le passé du classement.");
    expect(standingGap("2026-11-05", "2026-11-22")).toBe("Aucun relevé du classement cette semaine-là.");
    expect(territoryGap("2026-11-05", "2026-11-01")).toBe("Le territoire est relevé depuis le 5 nov.");
    expect(territoryGap(null, "2026-11-01")).toBe("Le territoire n'est pas encore relevé.");
    expect(territoryGap("2026-11-05", "2026-11-22")).toBe("Aucun relevé du territoire cette semaine-là.");
    expect(arrivalsGap(null, "2026-11-01")).toBe("La liste des membres n'a pas encore été relevée.");
    expect(arrivalsGap("2026-11-01T10:00:00.000Z", "2026-11-01")).toBe("La liste des membres date du 1 nov. 2026 : elle ne couvre pas encore toute cette semaine.");
    expect(arrivalsGap("2026-11-02T10:00:00.000Z", "2026-04-19")).toBe("La liste officielle ne connaît pas d'arrivée aussi ancienne.");
  });
  it("termine une phrase par un seul point, que le mois soit abrégé ou non", () => {
    expect(standingSentence({ start: null, end: snapshot("2026-08-03") }, "GAL")).toBe("[GAL] est 2e au classement officiel le 3 août.");
    expect(standingSentence({ start: null, end: snapshot("2026-11-01") }, "GAL")).not.toContain("..");
  });
  it("termine une date par un seul point dans tous les cas", () => {
    expect(endingOn("2026-11-05")).toBe("5 nov.");
    expect(endingOn("2026-08-05")).toBe("5 août.");
    expect(endingOn("2026-05-05")).toBe("5 mai.");
  });
  it("compare à la semaine d'avant, sans dire si c'est bien ou mal", () => {
    const totals = { games: 671, wins: 269, winRate: 40 };
    const compare = (previous: typeof plain.previous, current = totals) => comparisonSentence({ ...plain, totals: current, previous });
    expect(compare(null)).toBeNull();
    expect(compare({ games: 616, wins: 217, winRate: 35.1 })).toBe("55 parties de plus que la semaine d'avant. Taux de victoire : +4,9 points.");
    expect(compare({ games: 672, wins: 269, winRate: 41.5 })).toBe("1 partie de moins que la semaine d'avant. Taux de victoire : −1,5 point.");
    expect(compare({ games: 671, wins: 269, winRate: 40 })).toBe("Autant de parties que la semaine d'avant. Taux de victoire : +0,0 point.");
  });
  it("calcule l'écart sur les taux affichés : le lecteur doit pouvoir le refaire de tête", () => {
    // Semaines réelles : 41,7 % puis 35,2 %, soit −6,5 points, alors que les taux exacts donneraient −6,4.
    const totals = { games: 616, wins: 217, winRate: (217 / 616) * 100 };
    const previous = { games: 593, wins: 247, winRate: (247 / 593) * 100 };
    expect(comparisonSentence({ ...plain, totals, previous })).toContain("Taux de victoire : −6,5 points.");
  });
  it("n'invente pas de comparaison s'il n'y a pas de taux d'un côté ou de l'autre", () => {
    const none = { games: 0, wins: 0, winRate: null };
    const some = { games: 10, wins: 5, winRate: 50 };
    expect(comparisonSentence({ ...plain, totals: some, previous: none })).toBe("Aucune partie la semaine d'avant.");
    expect(comparisonSentence({ ...plain, totals: none, previous: some })).toBe("10 parties de moins que la semaine d'avant.");
    expect(comparisonSentence({ ...plain, totals: none, previous: none })).toBeNull();
  });
  it("n'écrit jamais d'écart négatif à zéro, et accorde « point »", () => {
    expect(fmtPoints(-0.04)).toBe("+0,0 point");
    expect(fmtPoints(1.96)).toBe("+2,0 points");
    expect(fmtPoints(-12.5)).toBe("−12,5 points");
  });
  it("écrit le chapeau à partir des chiffres, et accorde les mots", () => {
    const totals = { games: 671, wins: 269, winRate: (269 / 671) * 100 };
    expect(editionLead({ ...plain, totals }, "GAL")).toMatch(/^671 parties et 269 victoires, soit 40,1 %\.$/);
    expect(editionLead({ ...plain, totals: { games: 1, wins: 1, winRate: 100 } }, "GAL")).toMatch(/^1 partie et 1 victoire, soit 100,0 %\.$/);
    expect(editionLead({ ...plain, totals, previous: { games: 616, wins: 217, winRate: 35.2 } }, "GAL")).toContain("La semaine d'avant : 616 parties, 35,2 %.");
    expect(editionLead({ ...plain, totals, standing: { start: snapshot("2026-10-25"), end: snapshot("2026-11-01") } }, "GAL")).toContain("Au classement officiel, [GAL] est 2e le 25 oct. et 2e le 1 nov.");
  });
  it("dit qu'aucune partie n'a eu lieu, et n'annonce pas de taux sans partie", () => {
    expect(editionLead(plain, "GAL")).toBe("Aucune partie enregistrée cette semaine-là.");
    expect(editionLead({ ...plain, previous: { games: 0, wins: 0, winRate: null } }, "GAL")).toBe("Aucune partie enregistrée cette semaine-là.");
  });
});
