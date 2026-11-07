import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { changeSinceLastDay, dayHighlights, dayRows, filmDayMarks, parisDayOf } from "../../src/lib/clanmap/days";
import { fmtDay, fmtEpochDay, fmtEpochHour, fmtInt, fmtRank } from "../../src/lib/format";

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
/** Un film d'avant les dates reste publié jusqu'au passage suivant du robot : ces contrôles l'attendent. */
const datedFilm = film.version >= 4;
/** Ce que le film doit dire de GAL à la fin d'une journée : les chiffres du tableau. */
const galLine = (day: { pixels: number; rank: number | null }) => (day.rank === null ? "GAL n'est pas encore sur la carte." : `GAL : ${fmtRank(day.rank)} avec ${fmtInt(day.pixels)} pixels.`);
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
    // La licence du fond de carte reste citée.
    await expect(page.getByTestId("map-license").getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
    // Un chiffre si le terrain est connu, sinon aucune phrase : jamais un zéro inventé.
    const neutral = page.getByTestId("map-neutral-border");
    if (film.galSummary.neutralBorder === undefined || film.galSummary.neutralBorder === null) await expect(neutral).toHaveCount(0);
    else expect(digits(await neutral.textContent())).toBe(String(film.galSummary.neutralBorder));
    await expect(page.getByTestId("map-journal")).not.toContainText("..");
  });

  test("la page s'ouvre sur la carte, et les détails restent repliés", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    const box = (await page.getByTestId("film-map").boundingBox())!;
    expect(box.y).toBeLessThan(testViewportTitleLimit);
    await expect(page.locator("main h1")).toHaveText("La carte des clans");
    await expect(page.getByTestId("data-status")).toBeVisible();
    for (const fold of ["fold-join", "fold-numbers", ...(datedFilm ? ["fold-days"] : []), "fold-fronts", "fold-read"]) {
      await expect(page.getByTestId(fold)).not.toHaveAttribute("open");
    }
    // Un bloc replié s'ouvre et se referme.
    const summary = page.getByTestId("fold-join").locator("summary");
    await summary.click();
    await expect(page.getByRole("heading", { name: "Donner des capsules" })).toBeVisible();
    await summary.click();
    await expect(page.getByRole("heading", { name: "Donner des capsules" })).toBeHidden();
  });

  // Avec « réduire les animations », le film attend ce bouton : il doit se voir dès l'arrivée sur la page.
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [900, 700],
    [1024, 768],
    [1180, 820],
    [1199, 800],
    [1200, 800],
    [1920, 1080],
  ] as const) {
    test(`à ${width} × ${height}, le bouton de lecture se voit sans défiler et rien ne déborde`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Formats testés une seule fois.");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto("/carte");
      await expect(playButton(page)).toBeVisible();
      await expect(playButton(page)).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      // Le bouton ne gagne pas sa place en écrasant la carte : le monde garde presque toute la largeur.
      const map = (await page.getByTestId("film-map").boundingBox())!;
      expect(Math.min(map.width, map.height * (film.cols / film.rows))).toBeGreaterThan(width * 0.9);
    });
  }

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

  test("le film donne les vraies dates, à l'heure de Paris", async ({ page }) => {
    test.skip(!datedFilm, "film sans dates, refait au prochain passage du robot");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();

    // À la fin de l'historique, comme à chaque position : la date de l'image affichée.
    const date = page.getByTestId("film-date");
    await expect(date).toHaveText(fmtEpochHour(lastFrame.at));
    const mid = Math.floor(film.frames.length / 2);
    await seekTo(page, mid);
    await expect(date).toHaveText(fmtEpochHour(film.frames[mid - 1].at));
    // Le lecteur d'écran ne lit pas l'incrustation sur la carte : le curseur dit la même date.
    await expect(page.getByTestId("film-pos")).toHaveAttribute("aria-valuetext", new RegExp(`^${fmtEpochHour(film.frames[mid - 1].at)}, événement `));
    // Avant le premier changement, il n'y a pas encore de date à montrer.
    await seekTo(page, 0);
    await expect(date).toBeHidden();

    // Sous la frise : le premier et le dernier jour, et un repère par jour.
    const marks = filmDayMarks(film.frames);
    const labels = page.getByTestId("film-dates").locator(".film-date");
    await expect(labels.first()).toHaveText(fmtDay(marks[0]!.date));
    await expect(labels.last()).toHaveText(fmtDay(marks.at(-1)!.date));
    await expect(page.getByTestId("film-dates").locator(".film-day")).toHaveCount(marks.length);
    // Les dates écrites ne se chevauchent pas et restent dans la frise.
    const scrub = (await page.getByTestId("film-dates").boundingBox())!;
    const boxes = await labels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, width: r.width })));
    boxes.forEach((box, i) => {
      expect(box.x).toBeGreaterThanOrEqual(scrub.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(scrub.x + scrub.width + 1);
      if (i > 0) expect(box.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width - 1);
    });
  });

  test("les grands moments portent leur date", async ({ page }) => {
    test.skip(!datedFilm, "film sans dates, refait au prochain passage du robot");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const first = page.getByRole("button", { name: /Premier pixel de GAL/ });
    const frame = Number(await first.getAttribute("data-film-moment"));
    await expect(first).toContainText(fmtEpochDay(film.frames[frame - 1].at));
    await page.getByRole("button", { name: /Dernier relevé/ }).click();
    expect(await position(page)).toBe(film.frames.length);
    // Le premier pixel de GAL et son record sont datés dans le détail des chiffres.
    await page.getByTestId("fold-numbers").locator("summary").click();
    await expect(page.getByTestId("film-fact").first()).toContainText(`Événement n° ${new Intl.NumberFormat("fr-FR").format(film.galSummary.firstEvent)}`);
    const since = changeSinceLastDay(dayRows(film.days, film.frames, film.fetchedAt), film.galSummary.pixels)!;
    await expect(page.getByTestId("map-journal")).toContainText(`${fmtInt(Math.abs(since.change))} pixels depuis la fin du ${fmtDay(since.date).replace(/\.$/, "")}`);
  });

  test("les grandes journées viennent de l'historique et se rejouent", async ({ page }) => {
    test.skip(!datedFilm, "film sans dates, refait au prochain passage du robot");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const { gain, loss } = dayHighlights(dayRows(film.days, film.frames, film.fetchedAt));
    const shown = [gain, loss].filter((d) => d !== null);
    const cards = page.getByTestId("map-day");
    await expect(cards).toHaveCount(shown.length);
    for (const [i, day] of shown.entries()) {
      const card = cards.nth(i);
      expect(digits(await card.locator("p").nth(1).textContent())).toBe(String(Math.abs(day.net)));
      await expect(card).toContainText(fmtDay(day.date));
      // Sans mouvement : directement la carte de la fin de cette journée, et sa légende.
      await card.getByRole("button", { name: "Revoir cette journée" }).click();
      expect(await position(page)).toBe(day.frame);
      await expect(page.locator("[data-film-caption]")).toContainText(fmtDay(day.date));
      // Le film montre la fin de ce jour-là, avec les chiffres du tableau.
      await expect(page.getByTestId("film-date")).toContainText(fmtDay(day.date));
      await expect(page.getByTestId("film-gal")).toHaveText(galLine(day));
      await expect(playButton(page)).not.toContainText("Pause");
    }
  });

  test("rejouer une journée s'arrête à la fin de ce jour", async ({ page }) => {
    test.skip(!datedFilm, "film sans dates, refait au prochain passage du robot");
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    const { gain } = dayHighlights(dayRows(film.days, film.frames, film.fetchedAt));
    test.skip(!gain, "aucune journée positive à rejouer");
    await page.getByTestId("map-day").first().getByRole("button", { name: "Revoir cette journée" }).click();
    await expect(playButton(page)).toContainText("Pause");
    expect(await position(page)).toBeGreaterThanOrEqual(gain!.start);
    await expect(playButton(page)).toContainText("Lecture", { timeout: 30_000 });
    expect(await position(page)).toBe(gain!.frame);
    await expect(page.getByTestId("film-date")).toContainText(fmtDay(gain!.date));
    await expect(page.getByTestId("film-gal")).toHaveText(galLine(gain!));
    // La suite du film repart d'ici, jusqu'au bout.
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Pause");
    await seekTo(page, film.frames.length - 1);
    await playButton(page).click();
    await expect(playButton(page)).toContainText("Pause");
    await expect.poll(() => position(page), { timeout: 15_000 }).toBe(film.frames.length);
  });

  test("jour après jour : une ligne par journée, le plus récent d'abord, sans date inventée", async ({ page }) => {
    test.skip(!datedFilm, "film sans dates, refait au prochain passage du robot");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/carte");
    await expect(playButton(page)).toBeVisible();
    await page.getByTestId("fold-days").locator("summary").click();
    const rows = dayRows(film.days, film.frames, film.fetchedAt).reverse();
    const lines = page.getByTestId("film-days").locator("tbody tr");
    await expect(lines).toHaveCount(rows.length);
    const first = rows[0]!;
    const cells = lines.first().locator("td");
    await expect(cells.first()).toContainText(fmtDay(first.date));
    expect(digits(await cells.nth(3).textContent())).toBe(String(Math.abs(first.net)));
    expect(digits(await cells.nth(4).textContent())).toBe(String(first.pixels));
    // Seule la dernière journée peut être en cours, et elle le dit.
    await expect(page.getByTestId("film-day-partial")).toHaveCount(rows.filter((r) => !r.complete).length);
    if (!rows[0]!.complete) await expect(page.getByTestId("film-day-partial")).toContainText("relevée jusqu'à");
    // Le dernier jour de la liste est celui du premier pixel de GAL.
    expect(rows.at(-1)!.date).toBe(parisDayOf(film.galSummary.firstAt));
    // Les jours du tableau retombent sur les totaux du film.
    expect(rows.reduce((n, r) => n + r.taken, 0)).toBe(film.galSummary.taken);
    expect(rows.reduce((n, r) => n + r.lost, 0)).toBe(film.galSummary.lost);
    // La fin de chaque journée a sa propre image : le film et le tableau disent la même chose.
    for (const r of rows) {
      const end = film.frames[r.frame - 1];
      expect(end.gal).toBe(r.pixels);
      expect(end.rank).toBe(r.rank);
      expect(parisDayOf(end.at)).toBe(r.date);
    }
    // Un jour se rejoue d'un clic.
    const day = rows[2]!;
    await lines.nth(2).getByRole("button").click();
    expect(await position(page)).toBe(day.frame);
    await expect(page.locator("[data-film-caption]")).toContainText(fmtDay(day.date));
    // La phrase de lecture décrit la frise datée.
    await page.getByTestId("fold-read").locator("summary").click();
    await expect(page.getByText("Des dates, mais pas une horloge.")).toBeVisible();
    await expect(page.getByText("Pas de dates dans le film.")).toHaveCount(0);
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
    // Les grandes journées restent lisibles, sans leur bouton inutile.
    if (datedFilm) {
      await expect(page.getByTestId("map-day").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Revoir cette journée" }).first()).toBeHidden();
    }
    // Les blocs repliés s'ouvrent sans JavaScript.
    await page.getByTestId("fold-fronts").locator("summary").click();
    await expect(page.getByTestId("film-fronts")).toBeVisible();
    if (datedFilm) {
      await page.getByTestId("fold-days").locator("summary").click();
      await expect(page.getByTestId("film-days")).toBeVisible();
    }
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
