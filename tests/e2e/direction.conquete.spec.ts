/**
 * La connexion sur tout le site et l'espace Direction, dans un vrai navigateur, sur un vrai Postgres.
 * Seule la page de Discord est remplacée : voir tests/support/fake-supabase.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

const API = `http://127.0.0.1:${process.env["GAL_TEST_SUPABASE_PORT"] ?? 54399}`;
const SITE = `http://127.0.0.1:${process.env["GAL_TEST_SITE_PORT"] ?? 4322}`;

const sql = (query: string, params: unknown[] = []) =>
  fetch(`${API}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: query, params }) }).then((r) => r.json()) as Promise<Record<string, unknown>[]>;

async function signIn(browser: Browser, name: string, from = "/compte"): Promise<Page> {
  const context = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(from);
  await page.getByTestId("sign-in").click();
  await page.getByLabel("Nom Discord").fill(name);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // L'en-tête montre le compte dès le retour de Discord, sans recharger la page.
  await expect(page.getByTestId("auth-account")).toContainText(/Gaulois n°/);
  await expect(page.getByTestId("auth-sign-in")).toHaveCount(0);
  return page;
}

const setRole = (name: string, role: string) =>
  sql("update public.profiles set status = 'validated', validated_at = now(), role = $2 where user_id = (select user_id from public.private_links where discord_name = $1)", [name, role]);

test("un visiteur voit le bouton de connexion sur tout le site, sans télécharger Supabase", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(API) && !r.url().includes("get_site_news")) calls.push(r.url());
  });
  for (const path of ["/", "/classement", "/membres"]) {
    await page.goto(path);
    await expect(page.getByTestId("auth-sign-in")).toBeVisible();
  }
  await page.getByTestId("auth-sign-in").click();
  await expect(page).toHaveURL(/compte/);
  expect(calls.filter((c) => !c.includes("/auth/"))).toEqual([]);
});

test("la connexion ramène sur l'espace Direction, et le lien suit le rôle", async ({ browser }) => {
  const page = await signIn(browser, "OfficierDirection", "/direction");
  await expect(page).toHaveURL(/direction/);
  await expect(page.getByTestId("direction-forbidden")).toBeVisible();
  await expect(page.getByTestId("auth-direction")).toHaveCount(0);

  await setRole("OfficierDirection", "officer");
  await page.reload();
  await expect(page.getByTestId("direction")).toBeVisible();
  await expect(page.getByTestId("auth-direction")).toBeVisible();
  await expect(page.getByTestId("direction-tile")).toHaveCount(5);
  // Seul le fondateur voit la transmission.
  await expect(page.getByTestId("direction-founder")).toHaveCount(0);
  await page.context().close();
});

test("un visiteur non connecté ne voit que l'invitation à se connecter", async ({ page }) => {
  await page.goto("/direction");
  await expect(page.getByTestId("direction-signed-out")).toBeVisible();
  await expect(page.getByTestId("direction")).toHaveCount(0);
});

test("un officier publie, l'accueil l'affiche à un visiteur, puis il supprime", async ({ browser, page }) => {
  const officer = await signIn(browser, "Publieur", "/direction");
  await setRole("Publieur", "officer");
  await officer.reload();
  const panel = officer.getByTestId("direction-announcements");
  await panel.getByLabel("Titre").fill("Soirée du clan");
  await panel.getByLabel("Texte").fill("Rendez-vous vendredi en vocal.");
  await panel.getByRole("button", { name: "Publier l'annonce" }).click();
  await expect(panel.getByText("Annonce publiée")).toBeVisible();

  const events = officer.getByTestId("direction-events");
  await events.getByLabel("Nom de l'événement").fill("Tournoi interne");
  await events.getByLabel("Date et heure").fill("2099-01-15T20:30");
  await events.getByRole("button", { name: "Publier l'événement" }).click();
  await expect(events.getByText("Événement publié")).toBeVisible();

  await page.goto("/");
  // Les annonces en direct se chargent quand le visiteur arrive à leur hauteur.
  await page.getByRole("heading", { name: "Annonces" }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("news-announcements")).toContainText("Soirée du clan");
  await expect(page.getByTestId("news-events")).toContainText("Tournoi interne");

  const row = panel.getByTestId("direction-announcement").filter({ hasText: "Soirée du clan" });
  await row.getByRole("button", { name: /^Modifier/ }).click();
  await expect(panel.getByLabel("Titre")).toHaveValue("Soirée du clan");
  await panel.getByLabel("Titre").fill("Soirée du clan, nouvelle date");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(panel.getByText("Annonce modifiée.")).toBeVisible();

  const edited = panel.getByTestId("direction-announcement").filter({ hasText: "nouvelle date" });
  await edited.getByRole("button", { name: /^Supprimer/ }).click();
  await expect(panel.getByText("Annonce supprimée.")).toHaveCount(0);
  await edited.getByRole("button", { name: /^Confirmer/ }).click();
  await expect(panel.getByText("Annonce supprimée.")).toBeVisible();

  await page.reload();
  await page.getByRole("heading", { name: "Annonces" }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("news-events")).toContainText("Tournoi interne");
  await expect(page.getByText("nouvelle date")).toHaveCount(0);
  await officer.context().close();
});

test("le serveur affiche son refus quand un lien n'est pas en https", async ({ browser }) => {
  const officer = await signIn(browser, "LienRefuse", "/direction");
  await setRole("LienRefuse", "officer");
  await officer.reload();
  const panel = officer.getByTestId("direction-announcements");
  await panel.getByLabel("Titre").fill("Lien");
  await panel.getByLabel("Texte").fill("Texte");
  await panel.getByLabel(/Lien en https/).fill("http://exemple.fr");
  await panel.getByRole("button", { name: "Publier l'annonce" }).click();
  await expect(panel.getByRole("alert")).toContainText("https://");
  await officer.context().close();
});

test("l'espace Direction respecte WCAG AA", async ({ browser }) => {
  const officer = await signIn(browser, "Accessible", "/direction");
  await setRole("Accessible", "officer");
  await officer.emulateMedia({ reducedMotion: "reduce" });
  await officer.reload();
  await expect(officer.getByTestId("direction")).toBeVisible();
  await expect(officer.getByTestId("direction-tile").first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page: officer }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ; ")}`)).toEqual([]);
  await officer.context().close();
});

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("sur téléphone, l'en-tête tient pour un visiteur, un membre et un officier", async ({ browser, page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("auth-sign-in")).toBeVisible();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);

  const name = "MembreAuNomVraimentTresTresLong";
  const user = await signIn(browser, name, "/direction");
  await setRole(name, "member");
  await user.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/direction", "/compte"]) {
    await user.goto(path);
    await expect(user.getByTestId("auth-account")).toBeVisible();
    expect(await overflowOf(user), `membre sur ${path}`).toBeLessThanOrEqual(0);
  }

  await setRole(name, "officer");
  for (const path of ["/", "/direction", "/compte"]) {
    await user.goto(path);
    // Un officier garde l'accès à la Direction, et son compte s'ouvre depuis cet espace.
    await expect(user.getByTestId("auth-direction")).toBeVisible();
    await expect(user.getByTestId("auth-account")).toBeHidden();
    expect(await overflowOf(user), `officier sur ${path}`).toBeLessThanOrEqual(0);
  }
  await user.context().close();
});

test("à toutes les largeurs, l'en-tête tient sur une ligne, même avec un long nom", async ({ browser }) => {
  const name = "OfficierLargeurAvecUnTresLongNom";
  const officer = await signIn(browser, name, "/direction");
  await setRole(name, "officer");
  await sql("update public.profiles set display_name = $1 where user_id = (select user_id from public.private_links where discord_name = $1)", [name]);
  for (const width of [640, 768, 1024, 1279, 1280, 1440, 1536, 1920]) {
    await officer.setViewportSize({ width, height: 800 });
    await officer.goto("/");
    await expect(officer.getByTestId("auth-direction")).toBeVisible();
    expect(await overflowOf(officer), `débordement à ${width} px`).toBeLessThanOrEqual(0);
    const header = await officer.evaluate(() => {
      const bar = document.querySelector("header .wrap") as HTMLElement;
      return { height: bar.getBoundingClientRect().height, scroll: bar.scrollWidth - bar.clientWidth };
    });
    expect(header.height, `hauteur à ${width} px`).toBeLessThan(72);
    expect(header.scroll, `en-tête à ${width} px`).toBeLessThanOrEqual(0);
  }
  await officer.context().close();
});

test("se déconnecter remet le bouton de connexion dans l'en-tête", async ({ browser }) => {
  const user = await signIn(browser, "Partant2");
  await user.getByRole("button", { name: /Se déconnecter/ }).click();
  await expect(user.getByTestId("auth-sign-in")).toBeVisible();
  await user.context().close();
});
