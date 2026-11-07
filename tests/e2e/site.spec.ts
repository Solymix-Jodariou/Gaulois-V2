import { existsSync, readdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clan } from "../../config/clan";
import { loadTerritoryReadings, loadGames, loadHistory, loadMemberGames, loadMembers, loadMeta, loadSessions } from "../../src/lib/data";
import { fmtCount } from "../../src/lib/format";
import { faceOffs, mapResults } from "../../src/lib/games";
import { editionLead, gazetteEditions, rankWords, standingDetails, territoryDetails, weekLabel } from "../../src/lib/gazette";
import { gamesOf, recentGamesTitle } from "../../src/lib/members";
import { mapLabel } from "../../src/lib/map-names";

const PAGES = ["/", "/classement", "/progression", "/membres", "/activite", "/carte", "/debuter", "/rejoindre", "/gazette"];
const lb = JSON.parse(readFileSync("data/leaderboard.json", "utf8"));
const members = JSON.parse(readFileSync("data/members.json", "utf8"));
const gal = lb.clans.find((c: { clanTag: string }) => c.clanTag === "GAL");
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** Attend que les composants interactifs de la page aient démarré. */
const hydrated = (page: Page) => page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));

test("sans serveur configuré, la connexion n'apparaît pas et le site reste statique", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("supabase") || r.url().includes("/rest/v1/")) calls.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByTestId("auth-sign-in")).toHaveCount(0);
  for (const path of ["/compte", "/admin", "/direction"]) {
    await page.goto(path);
    await expect(page.getByTestId("auth-not-open")).toBeVisible();
  }
  expect(calls).toEqual([]);
});

test("parcours principal", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("api.openfront.io")) apiCalls.push(r.url());
  });

  // Accueil : les cartes affichent les valeurs collectées.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Rejoindre le Discord" })).toHaveAttribute("href", "https://discord.gg/cjUc42T7Y2");
  await expect(page.getByRole("link", { name: "Jouer à OpenFront" }).first()).toBeVisible();
  const cards = page.getByTestId("stat-card");
  await expect(cards).toHaveCount(5);
  await expect(async () => {
    expect(digits(await cards.nth(2).locator("[data-count]").textContent())).toBe(String(gal.games));
  }).toPass();
  await expect(page.getByTestId("data-status")).toContainText("Dernière mise à jour");
  await expect(page.getByText("Site communautaire non officiel, sans lien avec les éditeurs d'OpenFront.")).toBeVisible();

  // Classement : navigation, ligne mise en évidence, recherche.
  if (mobile) await page.getByText("Menu", { exact: true }).click();
  await page.getByRole("link", { name: "Classement", exact: true }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/classement/);
  await hydrated(page);
  await expect(page.locator(".row-highlight").filter({ visible: true })).toContainText("[GAL]");
  await page.getByLabel("Rechercher un clan").fill("gal");
  await expect(page.getByText(/clans? sur \d+/)).toContainText("sur");
  await page.getByLabel("Rechercher un clan").fill("zzzzzz");
  await expect(page.getByText("Aucun clan ne correspond")).toBeVisible();

  // Progression : le filtre change le résumé et le tableau reste accessible.
  await page.goto("/progression");
  await hydrated(page);
  const summary = page.getByTestId("summary-Parties");
  await expect(summary).not.toBeEmpty();
  await page.getByRole("button", { name: "30 jours" }).click();
  const month = digits(await summary.textContent());
  await page.getByRole("button", { name: "7 jours" }).click();
  await expect(async () => expect(Number(digits(await summary.textContent()))).toBeLessThan(Number(month))).toPass();
  await page.getByText("Voir le tableau des parties").click();
  await expect(page.getByRole("table").filter({ visible: true }).locator("tbody tr")).toHaveCount(7);

  // Membres : liste officielle, anonymes, recherche, tri.
  await page.goto("/membres");
  await hydrated(page);
  await expect(page.getByTestId("member-count")).toContainText(`${members.total}`.replace(/\B(?=(\d{3})+$)/g, " "));
  await expect(page.getByText("Membre anonyme").filter({ visible: true }).first()).toBeVisible();
  const named = members.members.find((m: { username: string | null }) => m.username)?.username;
  await page.getByLabel("Rechercher par pseudo").fill(named);
  await expect(page.getByRole("link", { name: named }).filter({ visible: true }).first()).toBeVisible();
  await page.getByLabel("Rechercher par pseudo").fill("");
  if (mobile) await page.getByLabel("Trier par").selectOption("joinedAt");
  else await page.getByRole("button", { name: /Arrivée/ }).click();
  await expect(page.getByText(/\d+ affichés/)).toBeVisible();

  // Activité : la précision obligatoire et la heatmap.
  await page.goto("/activite");
  await expect(page.getByText("Ce sont des parties enregistrées, pas des joueurs connectés.")).toBeVisible();
  await expect(page.getByTestId("best-slot").first()).toBeVisible();

  // Débuter : le calculateur réagit et ne dépend pas de la frontière.
  await page.goto("/debuter");
  await hydrated(page);
  await expect(page.getByTestId("guide-card")).toHaveCount(5);
  await expect(page.getByTestId("guide-chapter")).toHaveCount(11);
  await expect(page.getByTestId("growth-chart").locator("svg")).toBeVisible();
  await expect(page.getByText("Ce guide reste à rédiger")).toHaveCount(0);
  // Le wiki est sous CC BY-SA : sa mention ne doit pas disparaître de la page.
  await expect(page.getByTestId("guide-sources").getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
  await expect(page.getByText("Repère indicatif, pas une garantie.")).toBeVisible();
  const minimum = page.getByTestId("calc-minimum");
  await expect(minimum).not.toBeEmpty();
  const plains = await minimum.textContent();
  await page.getByLabel("Frontière").fill("500");
  await expect(minimum).toHaveText(plains ?? "");
  await page.getByLabel("Terrain").selectOption("mountain");
  await expect(minimum).not.toHaveText(plains ?? "");
  await page.getByLabel("Taille du bot").fill("0");
  await expect(page.getByTestId("calc-result").getByRole("alert")).toBeVisible();

  // Rejoindre.
  await page.goto("/rejoindre");
  await expect(page.getByTestId("join-steps").locator("li")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Demandez une invitation" })).toBeVisible();

  expect(apiCalls, "aucun appel à l'API OpenFront depuis le navigateur").toEqual([]);
});

test("l'accueil n'affiche que des données collectées", async ({ page }) => {
  await page.goto("/");
  const title = page.getByRole("heading", { name: /membres dans le clan/i });
  expect(digits(await title.textContent())).toBe(String(members.total));
  const command = members.members.filter((m: { role: string }) => m.role !== "member");
  await expect(page.getByRole("heading", { name: new RegExp(`Encadrement · ${command.length}`, "i") })).toBeVisible();
  for (const m of command) {
    if (m.username) await expect(page.getByText(m.username, { exact: true })).toBeVisible();
  }
});

for (const path of ["/", "/rejoindre"]) {
  test(`le bloc de jeu en groupe mène au Discord : ${path}`, async ({ page }) => {
    await page.goto(path);
    const block = page.getByTestId("group-play");
    await expect(block.getByTestId("group-size").first()).toContainText("Seul sous le tag");
    await expect(block.getByRole("link", { name: "Trouver un groupe sur Discord" })).toHaveAttribute("href", "https://discord.gg/cjUc42T7Y2");
  });
}

// Ces fichiers n'existent qu'après la première collecte : sans eux, rien ne doit s'afficher de faux.
test("le classé ne publie que des décomptes, à part du classement des clans", async ({ page }) => {
  await page.goto("/classement");
  const block = page.getByTestId("ranked-block");
  const panels = block.getByTestId("ranked-mode");
  if (!existsSync("data/ranked.json")) {
    await expect(panels).toHaveCount(0);
    return;
  }
  const ranked = JSON.parse(readFileSync("data/ranked.json", "utf8"));
  await expect(block).toContainText("ne compte pas dans le score du clan");
  await expect(block).toContainText("ces nombres sont donc des minimums");
  await expect(panels).toHaveCount(3);
  for (const [i, key] of ["1v1", "2v2", "ffa"].entries()) {
    const mode = ranked.modes[key];
    expect(digits(await panels.nth(i).getByTestId("ranked-members").textContent())).toBe(String(mode.members));
    expect(digits(await panels.nth(i).getByTestId("ranked-top").textContent())).toBe(`${mode.top}10`);
  }
  // Aucun nom ni chiffre individuel : ni lien de profil, ni tableau de joueurs.
  await expect(block.getByRole("link")).toHaveCount(0);
  await expect(block.getByRole("table")).toHaveCount(0);
  await expect(block).toContainText("Dernière mise à jour");
});

test("la course avec les voisins part du premier relevé", async ({ page }) => {
  await page.goto("/classement");
  await hydrated(page);
  const race = page.getByTestId("rival-race");
  const me = lb.clans.indexOf(gal);
  if (me < 0 || !existsSync("data/rivals") || readdirSync("data/rivals").length === 0) {
    await expect(race).toHaveCount(0);
    return;
  }
  await expect(race).toContainText("L'API ne donne pas le passé du classement");
  const gaps = race.getByRole("heading", { name: /^Face à \[/ });
  // Le clan au-dessus et les deux en dessous, s'ils existent.
  await expect(gaps).toHaveCount(lb.clans.filter((_: unknown, i: number) => i !== me && i >= me - 1 && i <= me + 2).length);
  await race.getByText("Voir le tableau des écarts").click();
  await expect(race.getByRole("table").locator("tbody tr")).toHaveCount(readdirSync("data/rivals").length);
});

test("les résultats par format donnent le repère du hasard et les records", async ({ page }) => {
  await page.goto("/progression");
  const formats = page.getByTestId("format-results");
  await expect(formats.getByTestId("format-row").first()).toContainText("au hasard");
  await expect(formats).toContainText("à 2 équipes, le hasard donne déjà 50 %");
  await expect(page.getByTestId("clan-record")).toHaveCount(4);
  await expect(page.getByTestId("clan-records")).toContainText("n'est pas comptée");
});

// Le détail des parties se lit petit à petit : tant qu'aucune carte ni aucun clan n'atteint son seuil, rien ne s'affiche.
test("les résultats par carte de jeu se comparent aux habitudes du clan et disent ce qui est lu", async ({ page }) => {
  await page.goto("/progression");
  const block = page.getByTestId("map-results");
  const results = mapResults(loadSessions(), loadGames(), loadMeta().sessions.coveredUntil);
  if (!results || results.rows.length === 0) {
    await expect(block.getByTestId("map-row")).toHaveCount(0);
    return;
  }
  await expect(block).toContainText("à ne pas confondre avec la carte des clans");
  await expect(block).toContainText("CC BY-SA 4.0");
  await expect(block).toContainText("Dernière mise à jour");
  expect(digits(await block.getByTestId("games-coverage").textContent())).toContain(String(results.coverage.read));
  const signals = results.strong.length + results.weak.length;
  await expect(block.getByTestId("map-row")).toHaveCount(results.rows.length + signals);
  // Aucune carte n'est dite forte ou faible sans écart que le hasard n'explique pas.
  await expect(block.getByTestId("maps-strong").getByTestId("map-row")).toHaveCount(results.strong.length);
  await expect(block.getByTestId("maps-weak").getByTestId("map-row")).toHaveCount(results.weak.length);
  await expect(block.getByTestId("maps-verdict")).toHaveCount(signals === 0 ? 1 : 0);
  const mostPlayed = results.rows[0];
  const row = block.getByTestId("map-row").nth(signals);
  await expect(row).toContainText(mapLabel(mostPlayed?.map ?? ""));
  await expect(row).toContainText(`${fmtCount(mostPlayed?.wins ?? 0, "victoire")} sur ${fmtCount(mostPlayed?.games ?? 0, "partie")} · d'habitude`);
});

test("les face-à-face reprennent les chiffres calculés, sans aucun joueur", async ({ page }) => {
  await page.goto("/classement");
  const block = page.getByTestId("face-offs");
  const panels = block.getByTestId("face-off");
  const result = faceOffs(loadSessions(), loadGames(), "GAL", lb.clans.map((c: { clanTag: string }) => c.clanTag), loadMeta().sessions.coveredUntil);
  if (!result?.reliable || result.rows.length === 0) {
    await expect(panels).toHaveCount(0);
    return;
  }
  await expect(block).toContainText("L'API ne donne pas toujours l'équipe des perdants");
  await expect(block).toContainText("Dernière mise à jour");
  await expect(panels).toHaveCount(result.rows.length);
  for (const [i, row] of result.rows.entries()) {
    const panel = panels.nth(i);
    await expect(panel.getByRole("heading")).toHaveText(`[${row.tag}]`);
    expect(digits(await panel.getByTestId("face-off-meetings").textContent())).toBe(String(row.meetings));
    expect(digits(await panel.getByTestId("face-off-ours").textContent())).toBe(String(row.ours));
    expect(digits(await panel.getByTestId("face-off-theirs").textContent())).toBe(String(row.theirs));
    expect(digits(await panel.getByTestId("face-off-others").textContent())).toBe(String(row.others));
  }
  await expect(block.getByRole("link")).toHaveCount(0);
});

test("la gazette donne le bilan de la dernière semaine complète, et n'invente pas ce qui manque", async ({ page }) => {
  const history = loadHistory();
  const editions = gazetteEditions({ sessions: loadSessions(), history, territory: loadTerritoryReadings(), members: loadMembers(), archiveStart: clan.archiveStart, completeThrough: loadMeta().sessions.completeThrough });
  const latest = editions[0];
  if (!latest) throw new Error("La gazette devrait avoir au moins une semaine complète.");

  await page.goto("/gazette");
  const block = page.getByTestId("gazette-latest");
  await expect(block.getByRole("heading", { level: 2 })).toHaveText(`Semaine ${weekLabel(latest)}`);
  await expect(block.getByTestId("gazette-lead")).toHaveText(editionLead(latest, clan.tag));
  expect(digits(await block.getByTestId("gazette-totals").locator("p").first().textContent())).toBe(String(latest.totals.games));
  await expect(block.getByTestId("gazette-totals")).toContainText(fmtCount(latest.totals.wins, "victoire"));
  await expect(page.getByTestId("gazette-older")).toHaveCount(editions.length - 1);
  await expect(page.getByTestId("data-status").first()).toContainText("Dernière mise à jour");
  // Les mois abrégés finissent déjà par un point : aucune phrase ne doit en avoir deux. Les pseudos, eux, sont libres.
  for (const part of ["gazette-lead", "gazette-totals", "gazette-standing", "gazette-territory", "gazette-highlights"]) {
    expect(await block.getByTestId(part).textContent()).not.toMatch(/\.\./);
  }

  // Un relevé qui n'existe pas s'écrit « Pas de données », jamais zéro.
  const standing = block.getByTestId("gazette-standing");
  if (latest.standing) {
    await expect(standing).toContainText(rankWords(latest.standing.end.rank));
    for (const line of standingDetails(latest.standing)) await expect(standing).toContainText(line);
    await expect(standing).toContainText("90 jours glissants");
  } else {
    await expect(standing).toContainText("Pas de données");
  }
  const territory = block.getByTestId("gazette-territory");
  if (latest.territory) {
    expect(digits(await territory.locator("p").first().textContent())).toBe(String(latest.territory.end.pixels));
    for (const line of territoryDetails(latest.territory)) await expect(territory).toContainText(line);
  } else {
    await expect(territory).toContainText("Pas de données");
  }
  const arrivals = block.getByTestId("gazette-arrivals");
  if (latest.arrivals) {
    expect(digits(await arrivals.locator("p").first().textContent())).toBe(String(latest.arrivals.count));
    await expect(arrivals).toContainText("Seuls les membres encore dans le clan sont comptés");
  } else {
    await expect(arrivals).toContainText("Pas de données");
  }

  // La navigation est pleine : on y arrive depuis l'accueil et le pied de page.
  await expect(page.locator("footer").getByRole("link", { name: "La gazette du clan" })).toHaveAttribute("href", /\/gazette$/);
  await page.goto("/");
  const home = page.getByTestId("home-gazette");
  await expect(home).toContainText(editionLead(latest, clan.tag));
  await home.getByRole("link", { name: "Lire la gazette" }).click();
  await expect(page).toHaveURL(/gazette/);
});

test.describe("fiches des membres", () => {
  const roster = loadMembers()?.members ?? [];
  const named = roster.filter((m) => m.username && m.publicId);
  const active = [...named].sort((a, b) => (gamesOf(b) ?? 0) - (gamesOf(a) ?? 0))[0];
  const idle = named.find((m) => gamesOf(m) === 0);
  // Le mot le plus long, pas le pseudo le plus long : c'est lui qui peut faire déborder la page.
  const widestWord = (name: string | null) => Math.max(...(name ?? "").split(" ").map((word) => word.length));
  const longest = [...named].sort((a, b) => widestWord(b.username) - widestWord(a.username))[0];

  test("une fiche reprend les stats d'équipe du membre, et n'est pas indexée", async ({ page }) => {
    if (!active?.team) throw new Error("Il faudrait au moins un membre avec une partie sous le tag.");
    await page.goto(`/membres/${active.publicId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(active.username ?? "");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    const stats = page.getByTestId("member-stat");
    await expect(stats).toHaveCount(4);
    expect(digits(await stats.nth(0).locator("dd").textContent())).toBe(String(active.team.wins));
    expect(digits(await stats.nth(1).locator("dd").textContent())).toBe(String(active.team.losses));
    expect(digits(await stats.nth(2).locator("dd").textContent())).toBe(String(gamesOf(active)));
    await expect(page.getByTestId("member-stats")).toContainText("sans le classé");

    // Ni heure ni statistique d'un autre mode : le jour, la carte, le format et le résultat.
    const recent = loadMemberGames()[active.publicId ?? ""];
    const title = recent ? recentGamesTitle(recent, gamesOf(active) ?? 0) : null;
    const block = page.getByTestId("member-recent");
    if (recent && title) {
      await expect(block.getByTestId("member-recent-title")).toHaveText(title);
      await expect(block.getByTestId("member-game")).toHaveCount(recent.recent.length);
      expect(await block.locator("table").textContent()).not.toMatch(/\d{1,2}[:h]\d{2}/);
      await expect(block.getByTestId("map-names-credit")).toContainText("CC BY-SA 4.0");
    } else {
      await expect(block).toContainText("Pas de données");
      await expect(block.getByTestId("member-game")).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Son profil sur OpenFront" })).toHaveAttribute("href", `https://openfront.io/#modal=profile&publicID=${active.publicId}`);
    await page.getByRole("link", { name: "Retour aux membres" }).click();
    await expect(page).toHaveURL(/\/membres\/?$/);
  });

  test("un membre sans partie sous le tag n'a pas de faux zéro", async ({ page }) => {
    if (!idle) return;
    await page.goto(`/membres/${idle.publicId}`);
    await expect(page.getByTestId("member-no-game")).toHaveText("Aucune partie sous le tag");
    await expect(page.getByTestId("member-stat")).toHaveCount(0);
    await expect(page.getByTestId("member-recent")).toHaveCount(0);
  });

  test("le tableau des membres mène à la fiche, et un anonyme n'en a pas", async ({ page }) => {
    await page.goto("/membres");
    await hydrated(page);
    const link = page.getByRole("link", { name: active?.username ?? "", exact: true }).filter({ visible: true }).first();
    await expect(link).toHaveAttribute("href", new RegExp(`/membres/${active?.publicId}$`));
    expect(existsSync("dist/membres")).toBe(true);
    const pages = readdirSync("dist/membres").filter((name) => name !== "index.html");
    expect(pages.sort()).toEqual(named.map((m) => m.publicId).sort());
  });

  test("seuls les membres avec pseudo ont des parties gardées", () => {
    const ids = new Set(named.map((m) => m.publicId));
    expect(Object.keys(loadMemberGames()).filter((id) => !ids.has(id))).toEqual([]);
  });

  for (const width of [360, 375, 768, 1024, 1280, 1920]) {
    test(`la fiche au mot le plus long ne fait pas défiler la page à ${width} px`, async ({ page }) => {
      if (!longest) throw new Error("Il faudrait au moins un membre avec un pseudo.");
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/membres/${longest.publicId}`);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }
  test("une fiche passe le contrôle d'accessibilité", async ({ page }) => {
    await page.goto(`/membres/${active?.publicId}`);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

test("signale les données périmées au visiteur", async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.now() + 10 * 86_400_000));
  await page.goto("/classement");
  // La page peut suivre deux jeux de données, le classement et le classé : chacun a son message. Celui-ci est celui du classement.
  await expect(page.getByTestId("data-status").first().getByText(/Données périmées : dernière mise à jour il y a \d+ jours/)).toBeVisible();
});

test("affiche une erreur si la liste des membres ne charge pas", async ({ page }) => {
  await page.route("**/data/members.json", (r) => r.abort());
  await page.goto("/membres");
  await expect(page.getByRole("alert")).toContainText("n'a pas pu être chargée");
  await page.unroute("**/data/members.json");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByTestId("member-count")).toBeVisible();
});

for (const path of PAGES) {
  test(`accessibilité WCAG AA : ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ; ")}`)).toEqual([]);
  });
}

// 360 : une largeur courante de téléphone. 1024 : là où le décor de /rejoindre élargissait la page.
for (const width of [360, 375, 768, 1024, 1280, 1920]) {
  test(`aucun défilement horizontal à ${width} px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Largeurs testées une seule fois.");
    await page.setViewportSize({ width, height: 900 });
    for (const path of [...PAGES, "/confidentialite"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} à ${width} px`).toBeLessThanOrEqual(0);
    }
  });
}

// L'AGPL et les conditions d'OpenFront, voir NOTICE.md : le code et la mention restent accessibles sur toutes les pages.
test("chaque page donne le code source et la mention d'OpenFront", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Même pied de page sur mobile.");
  for (const path of [...PAGES, "/confidentialite", "/compte", "/admin", "/direction"]) {
    await page.goto(path);
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Code source", exact: true }), path).toHaveAttribute("href", "https://github.com/les-gaulois/les-gaulois.github.io");
    await expect(footer, path).toContainText("© OpenFront and Contributors");
  }
});

test("navigation au clavier : lien d'évitement et focus visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Clavier testé sur desktop.");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu" });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
});
