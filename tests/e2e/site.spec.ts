import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/classement", "/progression", "/membres", "/activite", "/carte", "/debuter", "/rejoindre"];
const lb = JSON.parse(readFileSync("data/leaderboard.json", "utf8"));
const members = JSON.parse(readFileSync("data/members.json", "utf8"));
const gal = lb.clans.find((c: { clanTag: string }) => c.clanTag === "GAL");
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** Attend que les composants interactifs de la page aient démarré. */
const hydrated = (page: Page) => page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));

test("sans serveur configuré, le jeu n'apparaît pas et le site reste statique", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("supabase") || r.url().includes("/rest/v1/")) calls.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Conquête", exact: true })).toHaveCount(0);
  for (const path of ["/conquete", "/dons", "/compte", "/admin"]) {
    await page.goto(path);
    await expect(page.getByTestId("game-not-open")).toBeVisible();
  }
  // Les règles restent lisibles, sans rien demander au serveur.
  await page.goto("/conquete/regles");
  await expect(page.getByTestId("rules")).toContainText("Phase 1");
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
  await expect(page.getByTestId("guide-card")).toHaveCount(4);
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

test("signale les données périmées au visiteur", async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.now() + 10 * 86_400_000));
  await page.goto("/classement");
  await expect(page.getByText(/Données périmées : dernière mise à jour il y a \d+ jours/)).toBeVisible();
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
    for (const path of [...PAGES, "/confidentialite", "/conquete/regles"]) {
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
  for (const path of [...PAGES, "/confidentialite", "/conquete", "/conquete/regles", "/dons", "/compte", "/admin"]) {
    await page.goto(path);
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Code source", exact: true }), path).toHaveAttribute("href", "https://github.com/Solymix-Jodariou/Gaulois-V2");
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
