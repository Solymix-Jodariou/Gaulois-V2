import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const PAGES = ["/", "/classement", "/progression", "/membres", "/activite", "/carte", "/debuter", "/rejoindre"];

/** Couleur franche de la case sous un point. Les vagues ambiantes, plus pâles, ne comptent pas. */
const tileAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const canvas = document.getElementById("fx-territory") as HTMLCanvasElement;
      const dpr = canvas.width / canvas.clientWidth;
      const cx = (Math.floor(px! / 28) + 0.5) * 28;
      const cy = (Math.floor(py! / 28) + 0.5) * 28;
      const [r, , b, a] = canvas.getContext("2d")!.getImageData(cx * dpr, cy * dpr, 1, 1).data;
      if (a! < 60) return null;
      return r! > b! ? "red" : "blue";
    },
    [x, y],
  );

/** Surveille une case à chaque image : une vague ne peut pas passer entre deux contrôles. */
const seesTile = (page: Page, x: number, y: number, color: "blue" | "red") =>
  page.evaluate(
    ({ x, y, color }) =>
      new Promise<boolean>((resolve) => {
        const canvas = document.getElementById("fx-territory") as HTMLCanvasElement;
        const ctx = canvas.getContext("2d")!;
        const dpr = canvas.width / canvas.clientWidth;
        const cx = (Math.floor(x / 28) + 0.5) * 28 * dpr;
        const cy = (Math.floor(y / 28) + 0.5) * 28 * dpr;
        const begin = performance.now();
        const check = () => {
          const [r, , b, a] = ctx.getImageData(cx, cy, 1, 1).data;
          if (a! >= 60 && (r! > b! ? "red" : "blue") === color) return resolve(true);
          if (performance.now() - begin > 2500) return resolve(false);
          requestAnimationFrame(check);
        };
        check();
      }),
    { x, y, color },
  );

/** Amène un élément au centre de l'écran sans défilement animé : le test ne vise pas une page en mouvement. */
const centerOnScreen = (locator: Locator) =>
  locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));

/**
 * Surveille à chaque image si un élément reçoit une animation lancée par le script.
 * À démarrer avant le clic : ces animations sont si brèves qu'un contrôle après coup peut les manquer.
 */
const seesScriptAnimation = (locator: Locator) =>
  locator.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const begin = performance.now();
        const check = () => {
          const found = el.getAnimations().some((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition));
          if (found) return resolve(true);
          if (performance.now() - begin > 4000) return resolve(false);
          requestAnimationFrame(check);
        };
        check();
      }),
  );

/** Attend que tous les blocs à l'écran soient entièrement révélés : avant, une case peut ne pas réagir au survol. */
const blocksSettled = (page: Page) =>
  page.waitForFunction(
    () =>
      ![...document.querySelectorAll<HTMLElement>(".stage, main .card")].some((el) => {
        const r = el.getBoundingClientRect();
        const onScreen = r.width > 0 && r.top < window.innerHeight * 0.9 && r.bottom > 0;
        return onScreen && (el.classList.contains("fx-hidden") || el.style.clipPath !== "");
      }),
  );

/** Attend que les composants interactifs de la page aient démarré. */
const hydrated = (page: Page) => page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));

/** Nombre de pixels franchement colorés sur la grille. */
const strongPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.getElementById("fx-territory") as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! >= 60) count++;
    return count;
  });

/** Retient si le dernier clic droit a gardé le menu habituel du navigateur. */
const watchContextMenu = (page: Page) =>
  page.evaluate(() => {
    window.addEventListener("contextmenu", (e) => {
      (window as unknown as { __prevented: boolean }).__prevented = e.defaultPrevented;
    });
  });
const menuPrevented = (page: Page) => page.evaluate(() => (window as unknown as { __prevented?: boolean }).__prevented);

const pauseButton = (page: Page) => page.getByRole("button", { name: "Mettre les animations en pause" });

/** Fait défiler toute la page, comme un visiteur, puis revient en haut. */
const scrollThrough = (page: Page) =>
  page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 350) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });

// Un point du fond de page, à gauche du contenu, à cette largeur d'écran.
const BACKGROUND = { x: 20, y: 500 };

test.describe("à la souris", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "La souris est testée sur desktop.");
    errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(() => {
    expect(errors, "aucune erreur JavaScript").toEqual([]);
  });

  test("l'accueil montre une première conquête sans aucun clic", async ({ page }) => {
    const [blue, red] = await Promise.all([seesTile(page, 20, 500, "blue"), seesTile(page, 1260, 500, "red")]);
    expect(blue).toBe(true);
    expect(red).toBe(true);
  });

  // Ces deux tests utilisent une page sans la conquête d'ouverture de l'accueil.
  test("le clic gauche lance une vague bleue", async ({ page }) => {
    await page.goto("/rejoindre");
    await page.mouse.click(BACKGROUND.x, BACKGROUND.y);
    const [here, further] = await Promise.all([
      seesTile(page, BACKGROUND.x, BACKGROUND.y, "blue"),
      seesTile(page, BACKGROUND.x, BACKGROUND.y + 170, "blue"),
    ]);
    expect(here).toBe(true);
    expect(further).toBe(true);
  });

  test("le clic droit sur le fond lance une vague rouge, sans menu", async ({ page }) => {
    await page.goto("/rejoindre");
    await watchContextMenu(page);
    await page.mouse.click(BACKGROUND.x, BACKGROUND.y, { button: "right" });
    const [here, further] = await Promise.all([
      seesTile(page, BACKGROUND.x, BACKGROUND.y, "red"),
      seesTile(page, BACKGROUND.x, BACKGROUND.y + 170, "red"),
    ]);
    expect(here).toBe(true);
    expect(further).toBe(true);
    expect(await menuPrevented(page)).toBe(true);
  });

  test("une recherche tapée avant le démarrage de la page est prise en compte", async ({ page }) => {
    await page.route("**/_astro/*LeaderboardTable*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto("/classement", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Rechercher un clan").fill("zzzzzz");
    await expect(page.getByText("Aucun clan ne correspond")).toBeVisible({ timeout: 5000 });
  });

  test("le clic droit garde son menu sur un lien, avec Maj et sur du texte sélectionné", async ({ page }) => {
    await watchContextMenu(page);

    await page.getByRole("link", { name: "Classement", exact: true }).first().click({ button: "right" });
    expect(await menuPrevented(page)).toBe(false);

    await page.keyboard.down("Shift");
    await page.mouse.click(BACKGROUND.x, BACKGROUND.y, { button: "right" });
    await page.keyboard.up("Shift");
    expect(await menuPrevented(page)).toBe(false);
    expect(await tileAt(page, BACKGROUND.x, BACKGROUND.y)).not.toBe("red");

    const heading = page.locator("main h1");
    await heading.selectText();
    await heading.click({ button: "right" });
    expect(await menuPrevented(page)).toBe(false);
  });

  test("le clic dans un champ ne lance pas de vague", async ({ page }) => {
    await page.goto("/classement");
    await hydrated(page);
    await page.getByLabel("Rechercher un clan").click();
    await page.waitForTimeout(300);
    expect(await strongPixels(page)).toBeLessThan(20000);
  });

  test("le déplacement allume les cases sur son passage", async ({ page }) => {
    const lit = () =>
      page.evaluate(() => {
        const canvas = document.getElementById("fx-territory") as HTMLCanvasElement;
        const data = canvas.getContext("2d")!.getImageData(0, 300, 200, 200).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 40) count++;
        return count;
      });
    await page.mouse.move(10, 350);
    await page.mouse.move(40, 400, { steps: 8 });
    await expect.poll(lit, { timeout: 1000 }).toBeGreaterThan(500);
  });

  test("les blocs s'inclinent et un halo suit le curseur, puis tout revient", async ({ page }) => {
    const stage = page.locator(".stage-blue");
    await centerOnScreen(stage);
    await blocksSettled(page);
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2, { steps: 4 });
    await expect.poll(() => stage.evaluate((el: HTMLElement) => el.style.transform)).toContain("perspective");
    expect(await stage.evaluate((el: HTMLElement) => el.style.getPropertyValue("--spot"))).toBe("1");
    await expect
      .poll(() => stage.evaluate((el) => getComputedStyle(el, "::before").animationName))
      .toBe("frontier");

    await page.mouse.move(4, 4);
    await expect.poll(() => stage.evaluate((el: HTMLElement) => el.style.transform), { timeout: 3000 }).toBe("");
    expect(await stage.evaluate((el: HTMLElement) => el.style.getPropertyValue("--spot"))).toBe("");
  });

  test("une onde traverse le bloc cliqué", async ({ page }) => {
    const stage = page.locator(".stage-blue");
    await centerOnScreen(stage);
    await blocksSettled(page);
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const painted = () =>
      page.evaluate(
        ([x, y]) => {
          const canvas = document.getElementById("fx-sparks") as HTMLCanvasElement;
          const dpr = canvas.width / canvas.clientWidth;
          const data = canvas.getContext("2d")!.getImageData(x! * dpr, y! * dpr, 300, 60).data;
          let count = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
          return count;
        },
        [box.x + box.width / 2 - 150, box.y + box.height / 2],
      );
    await expect.poll(painted, { timeout: 1000 }).toBeGreaterThan(1000);
  });

  test("le logo suit le curseur et réagit aux deux boutons", async ({ page }) => {
    const logo = page.locator("[data-fx-logo]");
    await page.mouse.move(1200, 100, { steps: 4 });
    await expect.poll(() => logo.evaluate((el: HTMLElement) => el.style.transform)).toContain("rotateY");

    // Le logo flotte en permanence : on clique à ses coordonnées, sans attendre qu'il s'immobilise.
    const box = (await logo.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const pulse = seesScriptAnimation(logo);
    await page.mouse.click(center.x, center.y);
    expect(await pulse).toBe(true);
    await expect.poll(() => logo.evaluate((el) => el.getAnimations().length)).toBe(0);

    await watchContextMenu(page);
    const spin = seesScriptAnimation(logo);
    await page.mouse.click(center.x, center.y, { button: "right" });
    expect(await spin).toBe(true);
    expect(await menuPrevented(page)).toBe(true);
  });

  test("les blocs sont conquis case par case", async ({ page }) => {
    const stage = page.locator(".stage-wine");
    await expect(stage).toHaveClass(/fx-hidden/);
    const sawTiles = stage.evaluate(
      (el: HTMLElement) =>
        new Promise<boolean>((resolve) => {
          const observer = new MutationObserver(() => {
            if (el.style.clipPath.includes("path")) {
              observer.disconnect();
              resolve(true);
            }
          });
          observer.observe(el, { attributes: true, attributeFilter: ["style"] });
          setTimeout(() => resolve(false), 5000);
        }),
    );
    await centerOnScreen(stage);
    expect(await sawTiles).toBe(true);
    await expect.poll(() => stage.evaluate((el: HTMLElement) => el.style.clipPath), { timeout: 3000 }).toBe("");
    await expect(stage).not.toHaveClass(/fx-hidden/);
    await expect(stage).toHaveCSS("opacity", "1");
  });

  test("les compteurs finissent sur la valeur collectée", async ({ page }) => {
    const value = page.getByTestId("stat-card").nth(2).locator("[data-count]");
    const expected = await value.getAttribute("data-count");
    await centerOnScreen(value);
    await expect.poll(async () => (await value.textContent())?.replace(/\D/g, ""), { timeout: 3000 }).toBe(expected);
  });

  test("la barre de progression suit le défilement", async ({ page }) => {
    const bar = page.locator("#fx-progress");
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect
      .poll(() => bar.evaluate((el: HTMLElement) => Number(el.style.transform.match(/scaleX\(([\d.]+)\)/)?.[1] ?? 0)))
      .toBeGreaterThan(0.95);
  });

  test("le graphique suit le curseur et rejoue son animation à chaque période", async ({ page }) => {
    await page.goto("/progression");
    await hydrated(page);
    const bars = page.locator("[data-ripple-group] [data-ripple]");
    await expect(bars).toHaveCount(30);
    await centerOnScreen(bars.nth(15));
    await blocksSettled(page);
    const box = (await bars.nth(15).boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    const label = page.getByTestId("chart-label");
    await expect(label).toBeVisible();
    expect(Number((await label.textContent())?.replace(/\D/g, ""))).toBeGreaterThanOrEqual(0);
    await expect(page.locator(".chart-cursor")).toBeVisible();

    const wave = seesScriptAnimation(bars.nth(20));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await wave).toBe(true);

    await page.mouse.move(4, 4);
    await expect(label).toBeHidden();

    // Le balayage repart : l'élément est recréé à chaque changement de période.
    const firstSweep = await page.locator(".chart-sweep").elementHandle();
    await page.getByRole("button", { name: "7 jours" }).click();
    await expect(bars).toHaveCount(7);
    expect(await page.locator(".chart-sweep").evaluate((el, old) => el !== old, firstSweep)).toBe(true);
  });

  test("les chiffres défilent et finissent sur la bonne valeur", async ({ page }) => {
    await page.goto("/progression");
    await hydrated(page);
    await page.getByRole("button", { name: "7 jours" }).click();
    const screenReaderValue = page.locator("dd .sr-only").first();
    const value = page.getByTestId("summary-Parties");
    await expect.poll(async () => value.textContent(), { timeout: 2000 }).toBe(await screenReaderValue.textContent());
  });

  test("la heatmap réagit : réticule, infobulle et onde au clic", async ({ page }) => {
    await page.goto("/activite");
    await page.waitForLoadState("networkidle");
    const table = page.getByTestId("heatmap");
    const cell = table.locator("td[data-tip]").nth(100);
    await centerOnScreen(cell);
    await blocksSettled(page);
    await cell.hover();

    const tip = page.locator("#fx-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText((await cell.getAttribute("data-tip")) ?? "");
    await expect(table).toHaveClass(/fx-crosshair/);
    // Un jour : 24 cases et son en-tête. Une heure : 7 cases et son en-tête.
    expect(await table.locator(".fx-cross").count()).toBeGreaterThanOrEqual(32);

    const wave = seesScriptAnimation(table.locator("td[data-tip]").nth(3));
    await cell.click();
    expect(await wave).toBe(true);

    await page.mouse.move(4, 4);
    await expect(tip).toBeHidden();
    await expect(table).not.toHaveClass(/fx-crosshair/);
    expect(await table.locator(".fx-cross").count()).toBe(0);
  });

  test("le classement montre les scores en barres proportionnelles", async ({ page }) => {
    await page.goto("/classement");
    const first = page.locator("tbody tr").first().locator(".score-bar");
    await expect(first).toHaveAttribute("style", /width:\s*100%/);
    await expect(page.getByTestId("score-lanes").locator("li")).toHaveCount(3);
  });

  test("le calculateur rejoue l'attaque et le rejeu reste cohérent", async ({ page }) => {
    await page.goto("/debuter");
    await hydrated(page);
    const replay = page.getByTestId("attack-replay");
    await centerOnScreen(replay);
    const troops = page.getByTestId("replay-troops");
    const number = async () => Number((await troops.textContent())?.replace(/\D/g, "") ?? 0);
    await expect.poll(number, { timeout: 2000 }).toBeGreaterThan(0);
    const values = new Set<number>();
    await expect
      .poll(
        async () => {
          values.add(await number());
          return values.size;
        },
        { timeout: 6000, intervals: [120] },
      )
      .toBeGreaterThan(2);
    const minimum = Number((await page.getByTestId("calc-minimum").textContent())?.replace(/\D/g, ""));
    expect(Math.max(...values)).toBeLessThanOrEqual(minimum);
  });

  test("trier les membres fait glisser les lignes", async ({ page }) => {
    await page.goto("/membres");
    await expect(page.getByTestId("member-row").first()).toBeVisible();
    await page.waitForTimeout(800);
    // Trier par parties garde en grande partie les mêmes lignes : elles changent seulement de place.
    const glided = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const begin = performance.now();
          const check = () => {
            const found = [...document.querySelectorAll("tbody tr[data-key]")].some((row) =>
              row.getAnimations().some((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)),
            );
            if (found) return resolve(true);
            if (performance.now() - begin > 4000) return resolve(false);
            requestAnimationFrame(check);
          };
          check();
        }),
    );
    await page.getByRole("button", { name: /Parties/ }).click();
    expect(await glided).toBe(true);
  });

  test("le bouton pause arrête tout, et le choix est conservé", async ({ page }) => {
    await pauseButton(page).click();
    await expect(page.locator("html")).toHaveClass(/fx-off/);
    await expect(pauseButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#fx-territory")).toBeHidden();
    await expect(page.locator("#fx-progress")).toBeHidden();
    await expect(page.locator(".float")).toHaveCSS("animation-name", "none");
    await expect(page.locator(".fx-hidden")).toHaveCount(0);

    await watchContextMenu(page);
    await page.mouse.click(BACKGROUND.x, BACKGROUND.y, { button: "right" });
    expect(await menuPrevented(page)).toBe(false);

    await page.goto("/activite");
    await expect(page.locator("html")).toHaveClass(/fx-off/);
    await expect(page.locator(".fx-hidden")).toHaveCount(0);
    await expect(page.locator("[data-testid=heatmap] td[title]").first()).toBeAttached();

    await page.goto("/debuter");
    const troops = page.getByTestId("replay-troops");
    await expect(troops).not.toBeEmpty();
    const frozen = await troops.textContent();
    await page.waitForTimeout(400);
    expect(await troops.textContent()).toBe(frozen);

    await pauseButton(page).click();
    await expect(page.locator("html")).not.toHaveClass(/fx-off/);
    await expect(page.locator("#fx-territory")).toBeVisible();
  });

  for (const path of PAGES) {
    test(`accessibilité WCAG AA avec les effets : ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await scrollThrough(page);
      await page.waitForTimeout(1500);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ; ")}`)).toEqual([]);
    });
  }
});

// La garantie la plus importante : un effet ne doit jamais laisser de contenu masqué.
for (const path of PAGES) {
  test(`tous les blocs finissent visibles : ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await scrollThrough(page);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>(".stage, main .card")]
              .filter((el) => el.getBoundingClientRect().width > 0)
              .filter((el) => getComputedStyle(el).opacity !== "1" || el.style.clipPath !== "")
              .map((el) => el.className),
          ),
        { timeout: 2500 },
      )
      .toEqual([]);
    expect(errors).toEqual([]);
    await expect(page.locator("html")).not.toHaveClass(/fx-wait/);
  });
}

test("si le script échoue, les blocs s'affichent quand même", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Testé une seule fois.");
  await page.route("**/_astro/*script*", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/fx-wait/);
  await expect(page.locator(".stage-blue")).toHaveCSS("opacity", "1", { timeout: 4000 });
});

test("au toucher, une pression lance une vague et aucun effet de survol n'apparaît", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Le toucher est testé sur mobile.");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-fx-hint]")).toBeHidden();
  await page.touchscreen.tap(8, 300);
  expect(await seesTile(page, 8, 300, "blue")).toBe(true);
});

test("avec « réduire les animations », aucun effet n'est lancé", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#fx-territory")).toHaveCount(0);
  await expect(page.locator("#fx-progress")).toHaveCount(0);
  await expect(page.locator("[data-fx-toggle]")).toBeHidden();
  await expect(page.locator(".fx-hidden")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/fx-wait/);
  await watchContextMenu(page);
  await page.mouse.click(BACKGROUND.x, BACKGROUND.y, { button: "right" });
  expect(await menuPrevented(page)).toBe(false);
  await expect(page.locator("[data-fx-hint]")).toBeHidden();

  await page.goto("/debuter");
  await expect(page.getByTestId("replay-troops")).not.toBeEmpty();
});

test("sans JavaScript, tout le contenu reste visible", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("stat-card")).toHaveCount(5);
  await expect(page.locator(".stage-wine")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-fx-toggle]")).toBeHidden();
  await expect(page.locator("#fx-territory")).toHaveCount(0);
  await context.close();
});
