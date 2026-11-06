import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Sur tous les formats, la carte commence dans le haut de l'écran, juste sous l'en-tête et le titre.
 * Sur téléphone (375 px), sa position dépend de `data/meta.json`, que le robot réécrit à chaque collecte :
 * 133 px d'ordinaire, 171 px si la dernière collecte a échoué, 193 px si les données sont en plus périmées.
 * Ces avertissements sont voulus : une panne doit se signaler. La carte et son bouton de lecture restent alors sur le
 * premier écran. La limite couvre donc ce pire cas, pour que le test ne dépende pas du résultat de la dernière collecte.
 */
const testViewportTitleLimit = 200;
const film = JSON.parse(readFileSync("data/clanmap/film.json", "utf8"));
const lastFrame = film.frames.at(-1);
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

const position = (page: Page) => page.getByTestId("film-pos").inputValue().then(Number);
const playButton = (page: Page) => page.getByTestId("film-play");

/** Déplace la frise comme le ferait un visiteur. */
const seekTo = (page: Page, frame: number) =>
  page.getByTestId("film-pos").evaluate((el: HTMLInputElement, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);

/** Nombre de pixels peints par le film au-delà du fond de carte : il dépend du territoire affiché. */
const colorfulPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-film-canvas]")!;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 60) count++;
    }
    return count;
  });

/** Attend le premier dessin du film, puis renvoie le nombre de pixels colorés de la carte finale. */
const firstDrawing = async (page: Page) => {
  await expect.poll(() => colorfulPixels(page)).toBeGreaterThan(1000);
  return colorfulPixels(page);
};

test.describe("film de la carte", () => {
  let errors: string[];
  let apiCalls: string[];

  test.beforeEach(({ page }) => {
    errors = [];
    apiCalls = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("request", (r) => {
      if (r.url().includes("openfront.io")) apiCalls.push(r.url());
    });
  });

  test.afterEach(() => {
    expect(errors, "aucune erreur JavaScript").toEqual([]);
    expect(apiCalls, "aucun appel à OpenFront depuis le navigateur").toEqual([]);
  });

  test("la page donne les chiffres collectés avant même le film", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(page.getByTestId("data-status")).toContainText("Dernière mise à jour");
    await expect(page.getByTestId("film-gal")).toContainText(String(film.galSummary.rank));
    expect(digits(await page.getByTestId("film-fact").nth(1).locator("p").nth(1).textContent())).toBe(String(film.galSummary.pixels));
    await expect(page.getByTestId("film-fronts").locator("tbody tr")).toHaveCount(film.galSummary.fronts.length);
    await expect(page.getByText("pas le classement des clans").first()).toBeVisible();
    await page.getByTestId("fold-read").locator("summary").click();
    await expect(page.getByText(`${film.check.mismatches} écart sur`)).toBeVisible();
    await expect(page.getByTestId("map-journal")).not.toContainText("..");
  });

  test("la page s'ouvre sur la carte, et les détails restent repliés", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    const box = (await page.getByTestId("film-map").boundingBox())!;
    expect(box.y).toBeLessThan(testViewportTitleLimit);
    await expect(page.locator("main h1")).toHaveText("La carte des clans");
    await expect(page.getByTestId("data-status")).toBeVisible();
    for (const fold of ["fold-join", "fold-numbers", "fold-fronts", "fold-read"]) {
      await expect(page.getByTestId(fold)).not.toHaveAttribute("open");
    }
    // Un bloc replié s'ouvre et se referme.
    const summary = page.getByTestId("fold-join").locator("summary");
    await summary.click();
    await expect(page.getByRole("heading", { name: "Donner des capsules" })).toBeVisible();
    await summary.click();
    await expect(page.getByRole("heading", { name: "Donner des capsules" })).toBeHidden();
  });

  test("le film démarre seul, puis se met en pause et reprend", async ({ page }) => {
    await page.goto("/carte");
    await expect(playButton(page)).toContainText("Pause", { timeout: 8000 });
    await expect.poll(() => position(page)).toBeGreaterThan(3);

    await playButton(page).click();
    await expect(playButton(page)).toContainText("Lecture");
    const frozen = await position(page);
    await page.waitForTimeout(500);
    expect(await position(page)).toBe(frozen);

    await playButton(page).click();
    await expect.poll(() => position(page)).toBeGreaterThan(frozen);
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Lecture");
  });

  test("le film va jusqu'au bout et retombe sur les chiffres de la page", async ({ page }) => {
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    await page.getByRole("button", { name: "× 4" }).click();
    await seekTo(page, film.frames.length - 6);
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Rejouer", { timeout: 8000 });
    expect(await position(page)).toBe(film.frames.length);
    expect(digits(await page.getByTestId("film-gal").textContent())).toContain(String(lastFrame.gal));

    // Rejouer repart du début.
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Pause");
    expect(await position(page)).toBeLessThan(30);
  });

  test("la frise rejoue le passé et le film se dessine", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const finalPixels = await firstDrawing(page);

    // Au tout début, la carte est vide et GAL n'y est pas encore : ce n'est pas un zéro.
    await seekTo(page, 0);
    await expect(page.getByTestId("film-gal")).toHaveText("GAL n'est pas encore sur la carte.");
    await expect.poll(() => colorfulPixels(page)).toBeLessThan(finalPixels / 2);

    const mid = Math.floor(film.frames.length / 2);
    await seekTo(page, mid);
    const frame = film.frames[mid - 1];
    await expect(page.getByTestId("film-gal")).toContainText(new Intl.NumberFormat("fr-FR").format(frame.gal));
    await expect(page.locator("[data-film-event]")).toHaveText(/./);
    expect(digits(await page.locator("[data-film-event]").textContent())).toBe(`${frame.ev}${lastFrame.ev}`);

    await seekTo(page, film.frames.length);
    await expect.poll(() => colorfulPixels(page)).toBeGreaterThan(finalPixels * 0.9);
  });

  test("revoir le premier pixel de GAL", async ({ page }) => {
    await page.goto("/carte");
    await page.getByTestId("fold-numbers").locator("summary").click();
    await page.getByRole("button", { name: "Revoir ce moment" }).click();
    await expect(playButton(page)).toContainText("Pause");
    expect(await position(page)).toBeLessThan(10);
  });

  test("griser les autres clans et suivre GAL ne changent aucun chiffre", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const before = await page.getByTestId("film-gal").textContent();
    const pixels = await firstDrawing(page);

    const focus = page.getByRole("button", { name: "Griser les autres" });
    await focus.click();
    await expect(focus).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => colorfulPixels(page)).toBeLessThan(pixels);

    const follow = page.getByRole("button", { name: "Suivre GAL" });
    const followed = await follow.getAttribute("aria-pressed");
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", followed === "true" ? "false" : "true");
    await expect(page.getByTestId("film-gal")).toHaveText(before ?? "");
  });

  test("avec « réduire les animations », le film attend une demande", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toContainText("Lancer le film");
    await page.waitForTimeout(2500);
    expect(await position(page)).toBe(film.frames.length);
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Pause");
  });

  test("le bouton pause du site arrête le film et l'empêche de repartir", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Bouton testé sur desktop.");
    await page.goto("/carte");
    await expect(playButton(page)).toContainText("Pause", { timeout: 8000 });
    await page.getByRole("button", { name: "Mettre les animations en pause" }).click();
    await expect(playButton(page)).toContainText("Lecture");
    const frozen = await position(page);
    await page.waitForTimeout(400);
    expect(await position(page)).toBe(frozen);

    await page.goto("/carte");
    await expect(playButton(page)).toContainText("Lancer le film");
    await page.waitForTimeout(2500);
    expect(await position(page)).toBe(film.frames.length);
  });

  test("au survol, la carte nomme le clan", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Le survol est testé sur desktop.");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const box = (await page.locator("[data-film-canvas]").boundingBox())!;
    // L'Amérique du Sud, en grande partie occupée.
    await page.mouse.move(box.x + box.width * 0.31, box.y + box.height * 0.6);
    await expect(page.locator("[data-film-tip]")).toBeVisible();
    await expect(page.locator("[data-film-tip]")).not.toBeEmpty();
    await page.mouse.move(4, 4);
    await expect(page.locator("[data-film-tip]")).toBeHidden();
  });

  test("si le film ne charge pas, la carte finale reste et on peut réessayer", async ({ page }) => {
    await page.route("**/generated/carte/film.bin.gz", (r) => r.abort());
    await page.goto("/carte");
    await expect(page.getByText("Le film n'a pas pu être chargé.")).toBeVisible();
    await expect(page.locator("[data-testid=film-map] img")).toBeVisible();
    await expect(playButton(page)).toBeHidden();
    await expect(page.getByTestId("film-gal")).not.toBeEmpty();
    errors = [];
    await page.unroute("**/generated/carte/film.bin.gz");
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(playButton(page)).toBeVisible();
    await expect(page.getByText("Le film n'a pas pu être chargé.")).toBeHidden();
  });

  test("signale une carte périmée", async ({ page }) => {
    await page.clock.setFixedTime(new Date(Date.parse(film.fetchedAt) + 3 * 86_400_000));
    await page.goto("/carte");
    await expect(page.getByText(/Données périmées : dernière mise à jour il y a \d+/)).toBeVisible();
  });

  test("sans JavaScript, la carte finale et les chiffres restent", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await page.goto("/carte");
    await expect(page.locator("[data-testid=film-map] img")).toBeVisible();
    await expect(page.getByTestId("film-fact")).toHaveCount(3);
    // Les blocs repliés s'ouvrent sans JavaScript.
    await page.getByTestId("fold-fronts").locator("summary").click();
    await expect(page.getByTestId("film-fronts")).toBeVisible();
    await expect(playButton(page)).toBeHidden();
    await context.close();
  });

  test("Ma place : un membre retrouve son rang et le joueur à dépasser", async ({ page }) => {
    const all = JSON.parse(readFileSync("data/members.json", "utf8")).members as { username: string | null; team: { wins: number; losses: number } | null }[];
    const known = all.filter((m) => m.team);
    const sorted = [...known].sort((a, b) => (b.team?.wins ?? 0) - (a.team?.wins ?? 0));
    const named = sorted.find((m, i) => i > 0 && m.username && (m.team?.wins ?? 0) > 0 && (m.team?.wins ?? 0) < (sorted[0]?.team?.wins ?? 0));
    const wins = named?.team?.wins ?? 0;
    const rank = known.filter((m) => (m.team?.wins ?? 0) > wins).length + 1;
    await page.goto("/carte");
    await page.getByTestId("my-place").scrollIntoViewIfNeeded();
    const field = page.getByLabel("Votre pseudo dans le jeu");

    await field.fill(named?.username ?? "");
    const result = page.getByTestId("my-place-result");
    await expect(result).toContainText(`${rank}${rank === 1 ? "er" : "e"}`);
    await expect(result).toContainText(new Intl.NumberFormat("fr-FR").format(wins));
    await expect(result).toContainText("Prochain à dépasser");

    await field.fill("zzzzzzzzzz");
    await expect(page.getByText("Aucun membre avec ce pseudo.")).toBeVisible();
    await expect(result).toBeHidden();
  });

  test("Ma place : le premier du clan n'a personne à dépasser", async ({ page }) => {
    const all = JSON.parse(readFileSync("data/members.json", "utf8")).members as { username: string | null; team: { wins: number } | null }[];
    const first = [...all].filter((m) => m.team).sort((a, b) => (b.team?.wins ?? 0) - (a.team?.wins ?? 0))[0];
    test.skip(!first?.username, "Le premier du clan est anonyme.");
    await page.goto("/carte");
    await page.getByTestId("my-place").scrollIntoViewIfNeeded();
    await page.getByLabel("Votre pseudo dans le jeu").fill(first?.username ?? "");
    await expect(page.getByTestId("my-place-result")).toContainText("Personne devant");
  });

  test("Ma place : une panne de la liste se signale et peut se réessayer", async ({ page }) => {
    await page.route("**/data/members.json", (r) => r.abort());
    await page.goto("/carte");
    await page.getByTestId("my-place").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("my-place").getByRole("alert")).toContainText("n'a pas pu être chargée");
    errors = [];
    await page.unroute("**/data/members.json");
    await page.getByTestId("my-place").getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByTestId("my-place").getByRole("alert")).toBeHidden();
  });

  test("les grands moments s'affichent en sous-titre et se rejouent", async ({ page }) => {
    await page.goto("/carte");
    const caption = page.locator("[data-film-caption]");
    await expect(caption).toHaveText("Premier pixel de GAL", { timeout: 8000 });

    const push = page.getByRole("button", { name: /La plus grande poussée/ });
    const frame = Number(await push.getAttribute("data-film-moment"));
    await push.click();
    await expect(caption).toContainText("La plus grande poussée", { timeout: 8000 });
    await expect(push).toHaveAttribute("aria-current", "true");
    expect(await position(page)).toBeGreaterThanOrEqual(frame);
  });

  test("le calculateur traduit les capsules en pixels sans toucher aux chiffres de la carte", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    const before = await page.getByTestId("film-gal").textContent();
    const total = page.getByTestId("conquest-total");
    const pixels = page.getByTestId("conquest-pixels");

    await page.locator("[data-conquest-caps]").fill("1000");
    await expect.poll(async () => digits(await total.textContent())).toBe("1000");
    // 1 capsule = 100 troupes, 1 pixel neutre = 1 000 troupes.
    expect(digits(await pixels.textContent())).toBe("100");

    // Sans la fiche du clan, le nombre de membres vient de la liste des membres.
    const memberCount = film.treasury?.members ?? JSON.parse(readFileSync("data/members.json", "utf8")).total;
    await page.getByRole("button", { name: /Chaque membre/ }).click();
    await expect.poll(async () => digits(await total.textContent())).toBe(String(1000 * memberCount));
    expect(digits(await pixels.textContent())).toBe(String(100 * memberCount));
    await expect(page.getByTestId("film-gal")).toHaveText(before ?? "");
  });

  test("le calculateur montre ce qu'il faut pour atteindre l'objectif", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    const me = film.standings.findIndex((s: { tag: string }) => s.tag === "GAL");
    const above = film.standings[me - 1];
    const gap = above.pixels - film.standings[me].pixels + 1;
    await expect(page.getByTestId("map-gap")).toHaveText(new Intl.NumberFormat("fr-FR").format(gap));

    await page.getByTestId("conquest-goal").click();
    await expect(page.getByTestId("conquest-verdict")).toContainText(`en dépassant ${above.tag}`);
    expect(Number(digits(await page.getByTestId("conquest-pixels").textContent()))).toBeGreaterThanOrEqual(gap);
  });

  test("la simulation se dessine sur sa propre carte", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await page.getByTestId("conquest").scrollIntoViewIfNeeded();
    const canvas = page.locator("[data-conquest-map]");
    await expect(canvas).toBeVisible();
    // Couleur de la simulation : un bleu presque blanc, absent de la carte d'origine.
    const lit = () =>
      canvas.evaluate((el: HTMLCanvasElement) => {
        const { data } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i]! > 170 && data[i + 1]! > 225 && data[i + 2]! > 240) count++;
        return count;
      });
    const small = await lit();
    await page.locator("[data-conquest-caps]").fill("50000");
    await expect.poll(lit).toBeGreaterThan(small);
    await expect(page.getByText("Simulation, pas une prévision")).toBeVisible();
  });

  test("on peut regarder un front ou une zone, puis revenir à la vue d'ensemble", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const front = film.galSummary.fronts.find((f: { at: unknown }) => f.at);
    const caption = page.locator("[data-film-caption]");
    const world = page.getByRole("button", { name: "Vue d'ensemble" });

    await page.getByTestId("fold-fronts").locator("summary").click();
    await page.getByRole("button", { name: `Voir le front avec ${front.tag} sur la carte` }).click();
    await expect(caption).toContainText(`Front ${front.tag}`);
    await expect(world).toBeVisible();
    await world.click();
    await expect(caption).toBeHidden();
    await expect(world).toBeHidden();

    await page.getByRole("button", { name: /Zone 1/ }).click();
    await expect(caption).toContainText("Zone 1");
    expect(await position(page)).toBe(film.frames.length);
  });

  test("les joueurs mis en avant viennent des données, et aucun donateur n'est inventé", async ({ page }) => {
    const members = JSON.parse(readFileSync("data/members.json", "utf8")).members;
    const heroes = JSON.parse(readFileSync("content/carte-heros.json", "utf8"));
    await page.goto("/carte");

    const best = members
      .filter((m: { team: unknown }) => m.team)
      .sort((a: { team: { wins: number } }, b: { team: { wins: number } }) => b.team.wins - a.team.wins)[0];
    await expect(page.getByTestId("map-winners").locator("li").first()).toContainText(best.username ?? "Membre anonyme");
    await expect(page.getByTestId("map-painters").locator("li")).toHaveCount(members.filter((m: { role: string }) => m.role !== "member").length);

    if (heroes.donors.length === 0) {
      await expect(page.getByTestId("map-donors")).toContainText("Le clan n'a pas encore choisi de le publier ici.");
      await expect(page.getByTestId("map-donors").locator("li")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("map-donors").locator("li").first()).toContainText(heroes.donors[0].player);
    }
    await expect(page.getByText("Un don est permanent et non remboursable.")).toBeVisible();
  });

  test("l'accueil renvoie vers le film", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /pixels sur la carte/i })).toBeVisible();
    await page.getByRole("link", { name: "Voir le film de la conquête" }).click();
    await expect(page).toHaveURL(/carte/);
  });
});

test("sur téléphone, le film suit GAL sans déborder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Testé sur mobile.");
  await page.goto("/carte");
  await expect(page.getByRole("button", { name: "Suivre GAL" })).toHaveAttribute("aria-pressed", "true");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
