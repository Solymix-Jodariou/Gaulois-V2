/**
 * Le parcours complet, de la première connexion à la fin d'une saison, sur un vrai Postgres.
 * Seule la page de Discord est remplacée : voir tests/support/fake-supabase.ts.
 * Les tests se suivent et partagent la même partie, comme des joueurs sur la même saison.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { resolveAttack, troopsToWin, type Terrain } from "../../src/lib/conquete/rules";

const API = `http://127.0.0.1:${process.env["GAL_TEST_SUPABASE_PORT"] ?? 54399}`;
const MAP = JSON.parse(readFileSync("public/conquete/map-v1.json", "utf8")) as {
  territories: { id: number; name: string; terrain: Terrain; neighbours: number[] }[];
};
const byName = (name: string) => MAP.territories.find((t) => t.name === name)!;
const byId = (id: number) => MAP.territories[id - 1]!;
const digits = (s: string | null) => Number((s ?? "").replace(/\D/g, ""));
const hash = (id: string) => createHash("sha256").update(id).digest("hex");
const fr = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

const post = (path: string, body: unknown) => fetch(`${API}${path}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
const sql = (query: string, params: unknown[] = []) => post("/__test/sql", { sql: query, params }) as Promise<Record<string, unknown>[]>;
const service = (fn: string, args: Record<string, unknown> = {}) => post("/__test/service", { fn, args }) as Promise<{ ok: boolean }>;

/** Se connecte « avec Discord », dans un navigateur à part. */
async function signIn(browser: Browser, name: string, baseURL: string | undefined, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const context = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:4322", viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  await page.goto("/compte");
  await page.getByTestId("sign-in").click();
  await page.getByLabel("Nom Discord").fill(name);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByTestId("account")).toBeVisible();
  return page;
}

const openAdmin = async (page: Page, tab: string) => {
  await page.goto("/admin");
  await page.getByRole("tab", { name: tab }).click();
};

/** Valide un membre en passant par l'écran de l'officier. */
async function approve(officer: Page, discordName: string) {
  await openAdmin(officer, "Demandes");
  const row = officer.getByTestId("request-row").filter({ hasText: discordName });
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(officer.getByText("Membre validé.")).toBeVisible();
}

/** Appelle directement le serveur avec le jeton de la page, comme un tricheur qui contourne l'écran. */
const directCall = (page: Page, fn: string, args: Record<string, unknown>) =>
  page.evaluate(
    async ({ api, fn, args }) => {
      const session = JSON.parse(localStorage.getItem("gal-conquete-session") ?? "{}") as { access_token?: string };
      const res = await fetch(`${api}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: "x", Authorization: `Bearer ${session.access_token ?? "x"}` },
        body: JSON.stringify(args),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    { api: API, fn, args },
  );

const pickTerritory = (page: Page, name: string) => page.getByTestId("territory-select").selectOption({ label: name });

const act = async (page: Page, troops: number) => {
  await page.getByTestId("action-amount").fill(String(troops));
  await page.getByTestId("action-submit").click();
};

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const accessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ; ")}`)).toEqual([]);
};

test.describe.configure({ mode: "serial" });

let founder: Page;
let astra: Page;
let brenn: Page;
let visitor: Page;
const errors: string[] = [];

const watch = (page: Page, label: string) => {
  page.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
};

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:4322", viewport: { width: 1280, height: 800 } });
  visitor = await context.newPage();
  watch(visitor, "visiteur");
});

test.afterAll(() => {
  expect(errors, "aucune erreur JavaScript").toEqual([]);
});

test("un visiteur voit le jeu en lecture seule, et rien n'est présenté comme un zéro", async () => {
  const openfront: string[] = [];
  visitor.on("request", (r) => {
    if (r.url().includes("openfront.io")) openfront.push(r.url());
  });
  await visitor.goto("/conquete");
  await expect(visitor.getByTestId("no-season")).toContainText("Aucune saison en cours");
  await expect(visitor.getByRole("link", { name: "Conquête", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await visitor.goto("/dons");
  await expect(visitor.getByTestId("donors-empty")).toContainText("Cela ne veut pas dire que personne n'a donné");
  await visitor.goto("/admin");
  await expect(visitor.getByTestId("admin-signed-out")).toBeVisible();
  expect(openfront, "le navigateur n'appelle jamais OpenFront").toEqual([]);
});

test("un visiteur est refusé par le serveur, pas seulement par l'écran", async () => {
  await visitor.goto("/dons");
  const res = await directCall(visitor, "create_season", { p_name: "Pirate", p_config: {} });
  expect(res.status).toBe(401);
  expect(await sql("select 1 from public.seasons")).toEqual([]);
});

test("la connexion passe par Discord, et un compte connecté reste en attente", async ({ browser, baseURL }) => {
  founder = await signIn(browser, "ChefDiscord", baseURL);
  watch(founder, "fondateur");
  await expect(founder.getByTestId("account-status")).toContainText("En attente de validation");
  await founder.goto("/admin");
  await expect(founder.getByTestId("admin-denied")).toBeVisible();

  // Le premier fondateur se désigne depuis le tableau de bord de Supabase, jamais depuis le site.
  const [row] = await sql("select discord_id from public.private_links where discord_name = 'ChefDiscord'");
  const self = await directCall(founder, "bootstrap_founder", { p_discord_id: row!["discord_id"] });
  expect(self.status).toBe(401);
  expect(await service("bootstrap_founder", { p_discord_id: row!["discord_id"] })).toMatchObject({ ok: true });
  await founder.goto("/compte");
  await expect(founder.getByTestId("account-status")).toContainText("Fondateur");
});

test("un membre lie son profil, et seul un officier peut le valider", async ({ browser, baseURL }) => {
  const roster = [
    { hash: hash("PUB-ASTRA"), username: "Astra", role: "member" },
    { hash: hash("PUB-BRENN"), username: "Brenn", role: "member" },
    { hash: hash("PUB-ANON"), username: null, role: "member" },
  ];
  expect(await service("sync_clan_roster", { p_entries: roster, p_total: roster.length })).toMatchObject({ ok: true });

  astra = await signIn(browser, "AstraDiscord", baseURL);
  watch(astra, "astra");
  await astra.getByLabel("Pseudo OpenFront ou identifiant public").fill("astra");
  await astra.getByLabel("Un mot pour l'officier (facultatif)").fill("Je suis sur le vocal ce soir");
  await astra.getByRole("button", { name: "Demander ma validation" }).click();
  await expect(astra.getByTestId("request-pending")).toContainText("figure bien dans la liste");

  // Figurer dans la liste ne suffit pas, et cliquer soi-même encore moins.
  const [request] = await sql("select id from public.membership_requests order by id desc limit 1");
  expect((await directCall(astra, "review_membership", { p_request: request!["id"], p_approve: true })).body).toMatchObject({ ok: false, error: "not_validated" });
  expect((await directCall(astra, "list_members", {})).body).toMatchObject({ ok: false, error: "not_validated" });
  await astra.goto("/conquete");
  await expect(astra.getByText("Votre compte n'est pas encore validé").or(astra.getByTestId("no-season"))).toBeVisible();

  await openAdmin(founder, "Demandes");
  const row = founder.getByTestId("request-row").filter({ hasText: "AstraDiscord" });
  await expect(row.getByTestId("request-roster")).toContainText("Dans la liste : Astra");
  await expect(row).toContainText("Je suis sur le vocal ce soir");
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(founder.getByText("Membre validé.")).toBeVisible();

  await astra.goto("/compte");
  await expect(astra.getByTestId("account-status")).toContainText("Membre validé");
  await expect(astra.getByTestId("account-name")).toHaveText("Astra");

  // Un refus s'explique, et on peut recommencer.
  const impostor = await signIn(browser, "Usurpateur", baseURL);
  watch(impostor, "usurpateur");
  await impostor.getByLabel("Pseudo OpenFront ou identifiant public").fill("Astra");
  await impostor.getByRole("button", { name: "Demander ma validation" }).click();
  await expect(impostor.getByRole("alert")).toContainText("déjà lié à un compte");
  await impostor.getByLabel("Pseudo OpenFront ou identifiant public").fill("Brenn");
  await impostor.getByRole("button", { name: "Demander ma validation" }).click();
  await expect(impostor.getByTestId("request-pending")).toBeVisible();
  await openAdmin(founder, "Demandes");
  const claim = founder.getByTestId("request-row").filter({ hasText: "Usurpateur" });
  await claim.getByLabel("Raison (facultative)").fill("Inconnu sur le Discord");
  await claim.getByRole("button", { name: "Refuser" }).click();
  await expect(founder.getByText("Demande refusée.")).toBeVisible();
  await impostor.reload();
  await expect(impostor.getByTestId("request-refused")).toContainText("Inconnu sur le Discord");
  await impostor.context().close();
});

test("un don déclaré ne compte qu'une fois validé, et la capture part à la décision", async () => {
  await astra.goto("/compte");
  await expect(astra.getByTestId("my-capsules")).toHaveText("0");
  await astra.getByLabel("Capsules données").fill("10000");
  await astra.getByLabel("Capture (facultative, 2 Mo au plus)").setInputFiles({
    name: "preuve.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
  });
  await astra.getByRole("button", { name: "Déclarer ce don" }).click();
  await expect(astra.getByText("Déclaration envoyée.")).toBeVisible();
  await expect(astra.getByTestId("donation-row").first()).toContainText("En attente");
  await expect(astra.getByTestId("my-capsules")).toHaveText("0");
  expect(await sql("select name from storage.objects")).toHaveLength(1);

  // Une image trop lourde ou d'un autre type est refusée avant l'envoi.
  await astra.getByLabel("Capsules données").fill("1");
  await astra.getByLabel("Capture (facultative, 2 Mo au plus)").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("non") });
  await astra.getByRole("button", { name: "Déclarer ce don" }).click();
  await expect(astra.getByRole("alert")).toContainText("PNG, JPEG ou WebP");
  await astra.getByLabel("Capture (facultative, 2 Mo au plus)").setInputFiles([]);
  await astra.getByLabel("Capsules données").fill("");

  // Un membre ne valide pas son propre don, même en appelant le serveur directement.
  const [donation] = await sql("select id from public.donations order by id desc limit 1");
  expect((await directCall(astra, "review_donation", { p_donation: donation!["id"], p_approve: true })).body).toMatchObject({ ok: false, error: "forbidden" });

  await openAdmin(founder, "Dons");
  const row = founder.getByTestId("pending-donation").filter({ hasText: "Astra" });
  await expect(row).toContainText("10 000 capsules");
  // L'officier voit la capture, dans un onglet à part.
  const opened = founder.waitForEvent("popup");
  await row.getByRole("button", { name: "Voir la capture" }).click();
  const proof = await opened;
  await expect.poll(() => proof.url()).toContain("/storage/v1/object/sign/donation-proofs/");
  await proof.close();
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(founder.getByText("Don validé.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await sql("select name from storage.objects")).length).toBe(0);

  await astra.reload();
  await expect(astra.getByTestId("my-capsules")).toHaveText(fr(10_000));
});

test("le classement des donneurs respecte l'anonymat de chacun", async () => {
  await visitor.goto("/dons");
  const row = visitor.getByTestId("donor-row").first();
  await expect(row).toContainText("Anonyme");
  expect(digits(await row.locator("td").nth(2).textContent())).toBe(10_000);
  expect(await visitor.content()).not.toContain("Astra");
  await expect(visitor.getByTestId("donors-read-at")).toContainText("Relu le");

  await astra.getByTestId("show-name").check();
  await expect.poll(async () => (await sql("select anonymous_donations a from public.profiles where display_name = 'Astra'"))[0]!["a"]).toBe(false);
  await visitor.reload();
  await expect(visitor.getByTestId("donor-row").first()).toContainText("Astra");
});

test("un admin lance une saison, et chaque action reste au journal", async () => {
  await openAdmin(founder, "Saisons");
  await founder.getByLabel("Nom", { exact: true }).fill("Saison 1");
  await founder.getByRole("button", { name: "Créer la saison" }).click();
  await expect(founder.getByText("Saison créée")).toBeVisible();
  await founder.getByTestId("start-season").click();
  await expect(founder.getByText("Saison lancée.")).toBeVisible();

  await founder.getByRole("tab", { name: "Journal" }).click();
  await expect(founder.getByTestId("log-row").filter({ hasText: "season_started" })).toContainText("Gaulois n°");
  await expect(founder.getByTestId("log-row").filter({ hasText: "membership_approved" })).toContainText("Astra");

  await visitor.goto("/conquete");
  await expect(visitor.getByTestId("season-phase")).toContainText("Phase 1");
  await expect(visitor.getByTestId("conquest-map")).toBeVisible();
});

test("phase 1 : le départ, puis les terres libres voisines", async () => {
  await astra.goto("/conquete");
  // Le guide a son propre parcours, plus bas : Astra le ferme dès son arrivée.
  await astra.getByTestId("guide-close").click();
  // 10 000 capsules : 25 % de (100 000 + 2000 × 100).
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(75_000));
  await pickTerritory(astra, "Paris");
  await expect(astra.getByTestId("territory-name")).toHaveText("Paris");
  await expect(astra.getByTestId("action-preview")).toContainText("Le premier territoire est gratuit");
  await act(astra, 5000);
  await expect(astra.getByText("Vous vous installez à Paris")).toBeVisible();
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(70_000));
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText("Astra s'installe à Paris.");

  // La carte prend la couleur du joueur : ses terres sont une seule masse, à son nom et avec ses troupes.
  const paris = astra.locator(`[data-t="${byName("Paris").id}"]`);
  await expect(paris).toHaveClass(/is-mine/);
  const owner = await paris.getAttribute("data-owner");
  await expect(astra.locator(`.conq-owner[data-owner="${owner}"]`)).toHaveAttribute("style", /fill/);
  await expect(astra.getByTestId("owner-labels").locator(`[data-owner="${owner}"]`)).toContainText("Astra");
  await expect(astra.getByTestId("owner-labels").locator(`[data-owner="${owner}"]`)).toContainText(fr(5_000));

  // Une terre libre voisine : le prix du terrain, puis le reste en garnison.
  const list = astra.getByTestId("target-list");
  const neighbour = byId(byName("Paris").neighbours.find((n) => byId(n).terrain === "plains") ?? byName("Paris").neighbours[0]!);
  await list.getByRole("button", { name: neighbour.name }).click();
  const cost = { plains: 1600, highland: 2000, mountain: 2400 }[neighbour.terrain];
  await astra.getByTestId("action-amount").fill(String(cost + 1400));
  await expect(astra.getByTestId("action-preview")).toContainText(fr(1_400));
  await astra.getByTestId("action-submit").click();
  await expect(astra.getByText(`${neighbour.name} est à vous`)).toBeVisible();
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText(`Astra occupe ${neighbour.name}.`);

  // Une terre lointaine n'est pas à portée, et la guerre n'a pas commencé.
  await pickTerritory(astra, "Tokyo");
  await expect(astra.getByTestId("action-why")).toContainText("n'est pas voisin");
  await expect(astra.getByTestId("action-submit")).toHaveCount(0);

  // Le visiteur voit tout, et ne peut rien faire.
  await visitor.reload();
  await expect(visitor.getByTestId("rank-biggest")).toContainText("Astra");
  await pickTerritory(visitor, "Paris");
  await expect(visitor.getByTestId("territory-garrison")).toHaveText(fr(5_000));
  await expect(visitor.getByTestId("action-panel").getByTestId("sign-in")).toBeVisible();
  await expect(visitor.getByTestId("action-submit")).toHaveCount(0);
});

test("un don validé arrive en troupes sous les yeux du joueur, sans recharger la page", async () => {
  await astra.goto("/conquete");
  const before = digits(await astra.getByTestId("my-troops").textContent());
  await expect(astra.getByTestId("donation-rule")).toContainText("100 troupes en renfort");
  await expect(astra.getByTestId("checked-at")).toContainText("Actualisé à");

  // Le fond de la carte est le relief, dans la bonne taille selon l'écran, et il se charge.
  const relief = astra.locator(".conq-terrain");
  const href = (await relief.getAttribute("href"))!;
  expect(href).toMatch(/\/conquete\/terrain-v1(-small)?\.webp$/);
  expect((await astra.request.get(href)).status()).toBe(200);

  // Un visiteur regarde aussi, sans compte.
  await visitor.goto("/conquete");
  await expect(visitor.getByTestId("season-phase")).toContainText("Phase 1");

  // Astra déclare dans un autre onglet, comme un vrai joueur qui revient du jeu.
  const tab = await astra.context().newPage();
  await tab.goto("/compte");
  await tab.getByLabel("Capsules données").fill("250");
  await tab.getByRole("button", { name: "Déclarer ce don" }).click();
  await expect(tab.getByText("vos troupes arriveront à ce moment-là")).toBeVisible();
  await tab.close();
  // Rien ne bouge tant qu'un officier n'a pas validé.
  expect(digits(await astra.getByTestId("my-troops").textContent())).toBe(before);

  await openAdmin(founder, "Dons");
  const row = founder.getByTestId("pending-donation").filter({ hasText: "250 capsules" });
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(founder.getByText(`Don validé. ${fr(25_000)} troupes arrivent dans sa réserve.`)).toBeVisible();

  // Dans les 15 secondes, sans rien toucher.
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(before + 25_000), { timeout: 20_000 });
  await expect(astra.getByTestId("game-notices")).toContainText("Astra offre 250 capsules");
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText(`+${fr(25_000)} troupes en renfort`);
  // Le visiteur le voit passer aussi.
  await expect(visitor.getByTestId("game-notices")).toContainText("offre 250 capsules", { timeout: 20_000 });

  // Le compte du joueur le dit aussi.
  await astra.goto("/compte");
  await expect(astra.getByTestId("donation-row").first()).toContainText(`+${fr(25_000)}`);

  // Un don annulé reprend ses troupes.
  const [donation] = await sql("select id from public.donations where capsules = 250");
  expect(await directCall(founder, "cancel_donation", { p_donation: donation!["id"], p_reason: "Vérification du parcours" }).then((r) => r.body)).toMatchObject({ ok: true, troops_taken: 25_000 });
  await astra.goto("/conquete");
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(before));
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText("a été annulé par un officier");
});

test("le classement retrouve un joueur sur la carte", async () => {
  await astra.goto("/conquete");
  const svg = astra.locator(".conq-map-view svg");
  await expect(svg).toHaveAttribute("data-zoomed", "false");
  const find = astra.getByTestId("rank-biggest").getByRole("button", { name: /Astra.*trouver sur la carte/ });
  await find.click();
  await expect(svg).toHaveAttribute("data-zoomed", "true");
  await expect(astra.getByTestId("territory-name")).toBeVisible();
  await expect(astra.locator(".conq-hex.is-selected.is-mine")).toHaveCount(1);

  // On s'éloigne, puis on redemande le même joueur : la carte y retourne.
  const group = astra.locator(".conq-map-view svg > g");
  const there = await group.getAttribute("transform");
  await astra.locator(".conq-map-view").focus();
  for (let i = 0; i < 3; i++) await astra.keyboard.press("ArrowLeft");
  expect(await group.getAttribute("transform")).not.toBe(there);
  await find.click();
  await expect.poll(() => group.getAttribute("transform")).toBe(there);
});

test("la carte se manipule à la souris, sans bloquer la page", async () => {
  await astra.goto("/conquete");
  const group = astra.locator(".conq-map-view svg > g");
  await astra.getByRole("button", { name: "Vue d'ensemble" }).click();
  const before = await group.getAttribute("transform");
  await astra.getByRole("button", { name: "Zoomer", exact: true }).click();
  expect(await group.getAttribute("transform")).not.toBe(before);
  await astra.getByRole("button", { name: "Vue d'ensemble" }).click();
  expect(await group.getAttribute("transform")).toBe(before);

  // Cliquer sur un hexagone le choisit, sans déplacer la carte, et son nom s'affiche au survol.
  const target = astra.locator(`[data-t="${byName("Paris").id}"]`);
  await target.hover();
  await expect(astra.locator(".conq-tip")).toContainText("Paris");
  await target.click();
  await expect(astra.getByTestId("territory-name")).toHaveText("Paris");
  expect(await group.getAttribute("transform")).toBe(before);
  await astra.getByRole("button", { name: "Vue d'ensemble" }).click();

  // Au clavier aussi.
  await astra.locator(".conq-map-view").focus();
  await astra.keyboard.press("+");
  await astra.keyboard.press("ArrowLeft");
  expect(await group.getAttribute("transform")).not.toBe(before);

  // Une fois zoomée, on la déplace en glissant, sans choisir de territoire au passage.
  const svg = astra.locator(".conq-map-view svg");
  await astra.getByRole("button", { name: "Zoomer", exact: true }).click();
  await expect(svg).toHaveAttribute("data-zoomed", "true");
  const box = (await svg.boundingBox())!;
  const shown = await astra.getByTestId("territory-name").textContent();
  const start = await group.getAttribute("transform");
  await astra.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await astra.mouse.down();
  await astra.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 5 });
  await astra.mouse.up();
  expect(await group.getAttribute("transform")).not.toBe(start);
  await expect(astra.getByTestId("territory-name")).toHaveText(shown ?? "");

  // Au doigt : deux doigts qui s'écartent zooment autour de leur milieu.
  await astra.getByRole("button", { name: "Vue d'ensemble" }).click();
  await expect(svg).toHaveAttribute("data-zoomed", "false");
  await svg.evaluate((node, { x, y }) => {
    const fire = (type: string, pointerId: number, px: number, py: number) =>
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: "touch", clientX: px, clientY: py, isPrimary: pointerId === 1 }));
    fire("pointerdown", 1, x - 20, y);
    fire("pointerdown", 2, x + 20, y);
    fire("pointermove", 1, x - 30, y);
    fire("pointermove", 2, x + 30, y);
    fire("pointermove", 1, x - 60, y);
    fire("pointermove", 2, x + 60, y);
    fire("pointerup", 1, x - 60, y);
    fire("pointerup", 2, x + 60, y);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(svg).toHaveAttribute("data-zoomed", "true");
  // Un geste à deux doigts ne choisit pas de territoire non plus.
  await expect(astra.getByTestId("territory-name")).toHaveText(shown ?? "");

  // Les noms ne s'affichent qu'une fois assez près.
  await astra.getByRole("button", { name: "Vue d'ensemble" }).click();
  await expect(svg).toHaveAttribute("data-names", "false");
  for (let i = 0; i < 4; i++) await astra.getByRole("button", { name: "Zoomer", exact: true }).click();
  await expect(svg).toHaveAttribute("data-names", "true");
});

test("phase 2 : le combat suit l'aperçu, et les garde-fous s'appliquent", async ({ browser, baseURL }) => {
  brenn = await signIn(browser, "BrennDiscord", baseURL);
  watch(brenn, "brenn");
  await brenn.getByLabel("Pseudo OpenFront ou identifiant public").fill("PUB-BRENN");
  await brenn.getByRole("button", { name: "Demander ma validation" }).click();
  await expect(brenn.getByTestId("request-pending")).toBeVisible();
  await approve(founder, "BrennDiscord");

  // Brenn s'installe juste à côté d'Astra et s'étend d'une terre.
  const occupied = new Set((await sql("select territory_id from public.territory_state")).map((r) => r["territory_id"] as number));
  const front = byId([...occupied].flatMap((id) => byId(id as number).neighbours).find((n) => !occupied.has(n))!);
  await brenn.goto("/conquete");
  await brenn.getByTestId("guide-close").click();
  await pickTerritory(brenn, front.name);
  await act(brenn, 4000);
  await expect(brenn.getByText(`Vous vous installez à ${front.name}`)).toBeVisible();
  const second = byId(front.neighbours.find((n) => !occupied.has(n))!);
  await brenn.getByTestId("target-list").getByRole("button", { name: second.name }).click();
  await act(brenn, 3000);
  await expect(brenn.getByText(`${second.name} est à vous`)).toBeVisible();
  const third = byId(second.neighbours.find((n) => !occupied.has(n) && n !== front.id)!);
  await brenn.getByTestId("target-list").getByRole("button", { name: third.name }).click();
  await act(brenn, 3000);
  await expect(brenn.getByText(`${third.name} est à vous`)).toBeVisible();

  // Tant que la guerre n'a pas commencé, un membre ne peut pas être attaqué.
  await astra.goto("/conquete");
  await pickTerritory(astra, front.name);
  await expect(astra.getByTestId("action-why")).toContainText("la guerre n'a pas encore commencé");

  // Un simple membre ne déclenche pas la guerre.
  const [season] = await sql("select id from public.seasons order by id desc limit 1");
  expect((await directCall(astra, "set_war_date", { p_season: season!["id"], p_at: new Date().toISOString() })).body).toMatchObject({ ok: false, error: "forbidden" });

  await openAdmin(founder, "Saisons");
  founder.once("dialog", (d) => void d.accept());
  await founder.getByTestId("war-now").click();
  await expect(founder.getByText("La guerre commence.")).toBeVisible();

  // Le territoire vient d'être pris : il est protégé 24 h.
  await astra.reload();
  await pickTerritory(astra, front.name);
  await expect(astra.getByTestId("season-phase")).toContainText("Phase 2");
  await act(astra, 5000);
  await expect(astra.getByRole("alert")).toContainText("protégé jusqu'au");

  // Un jour plus tard.
  await sql("update public.territory_state set protected_until = now() - interval '1 minute'");
  await astra.reload();
  await pickTerritory(astra, front.name);
  await expect(astra.getByTestId("territory-garrison")).toHaveText(fr(4_000));

  // L'écran annonce le résultat exact, et le serveur le confirme.
  const toWin = troopsToWin(4000, front.terrain);
  await astra.getByRole("button", { name: /Juste assez/ }).click();
  await expect(astra.getByTestId("action-amount")).toHaveValue(String(toWin));
  await astra.getByTestId("action-amount").fill(String(toWin + 2000));
  const forecast = resolveAttack(toWin + 2000, 4000, front.terrain);
  await expect(astra.getByTestId("action-preview")).toContainText("Victoire prévue");
  await expect(astra.getByTestId("action-preview")).toContainText(fr(forecast.survivors));
  await astra.getByTestId("action-submit").click();
  await expect(astra.getByText(`Victoire ! ${front.name} est à vous`)).toBeVisible();
  const [row] = await sql("select garrison from public.territory_state where territory_id = $1", [front.id]);
  expect(Number(row!["garrison"])).toBe(forecast.survivors);
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText(`Astra a pris ${front.name} à Brenn.`);
  await expect(astra.getByTestId("rank-conquerors")).toContainText("Astra");

  // Une seconde attaque tout de suite : la recharge s'applique.
  await pickTerritory(astra, second.name);
  await act(astra, 2000);
  await expect(astra.getByRole("alert")).toContainText("prochaine attaque possible");

  // Une heure plus tard, l'attaque passe.
  await sql("update public.players set last_attack_at = now() - interval '2 hours'");
  await astra.reload();
  await pickTerritory(astra, second.name);
  await act(astra, 20_000);
  await expect(astra.getByText(`Victoire ! ${second.name} est à vous`)).toBeVisible();

  // Brenn n'a plus qu'une terre : elle ne peut pas être attaquée.
  await sql("update public.players set last_attack_at = now() - interval '2 hours'");
  await astra.reload();
  await pickTerritory(astra, third.name);
  await act(astra, 20_000);
  await expect(astra.getByRole("alert")).toContainText("dernier territoire");

  // Brenn, lui, peut toujours se renforcer.
  await brenn.reload();
  await pickTerritory(brenn, third.name);
  await act(brenn, 1000);
  await expect(brenn.getByText("compte maintenant")).toBeVisible();
});

test("l'écran de jeu : le ratio d'attaque, l'or, les bâtiments, les alliances, la trahison et la bombe", async () => {
  const landsOf = async (name: string) => (await sql("select s.territory_id id from public.territory_state s join public.profiles p on p.user_id = s.owner_id where p.display_name = $1 order by s.territory_id", [name])).map((r) => r["id"] as number);
  await sql("update public.players set gold = 200000, troops = 60000, troops_at = now(), gold_at = now()");
  await sql("update public.territory_state set protected_until = null");
  const astraLands = await landsOf("Astra");
  const [brennLand] = await landsOf("Brenn");
  const home = byId(astraLands.find((id) => byId(id).neighbours.includes(brennLand!)) ?? astraLands[0]!);
  const enemy = byId(brennLand!);

  // La carte remplit l'écran : pas de grand titre au-dessus, et les commandes se posent dessus.
  await astra.goto("/conquete");
  const arena = astra.getByTestId("arena");
  const box = (await arena.boundingBox())!;
  expect(box.width).toBe(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  expect(box.height).toBeGreaterThan(600);

  // Le ratio d'attaque : il règle l'envoi, et il reste d'une visite à l'autre.
  await expect(astra.getByTestId("my-gold")).toHaveText(fr(200_000));
  await astra.getByTestId("attack-ratio").fill("50");
  await expect(astra.getByTestId("attack-ratio-value")).toContainText("50 %");
  await astra.reload();
  await expect(astra.getByTestId("attack-ratio-value")).toContainText("50 %");
  await pickTerritory(astra, enemy.name);
  await expect(astra.getByTestId("action-amount")).toHaveValue("30000");

  // Construire : l'or part, la capacité monte, et le bâtiment se voit sur la carte.
  await pickTerritory(astra, home.name);
  const capacityBefore = digits(await astra.getByTestId("my-reserve").locator(".conq-of").first().textContent());
  await astra.getByTestId("build-city").click();
  await expect(astra.getByText(`Ville construit à ${home.name}`)).toBeVisible();
  await expect(astra.getByTestId("territory-building")).toHaveText("Ville");
  await expect(astra.getByTestId("my-gold")).toHaveText(fr(190_000));
  await expect(astra.getByTestId("build-menu")).toHaveCount(0);
  await expect(astra.getByTestId("map-buildings").locator(".is-city")).toHaveCount(1);
  expect(digits(await astra.getByTestId("my-reserve").locator(".conq-of").first().textContent())).toBe(capacityBefore + 100_000);
  await expect(astra.getByTestId("game-feed")).toContainText(`Astra construit une ville à ${home.name}`);

  // Le serveur refuse ce que l'écran ne propose plus.
  expect((await directCall(astra, "build", { p_request_id: crypto.randomUUID(), p_territory: home.id, p_kind: "port" })).body).toMatchObject({ ok: false, error: "building_exists" });
  expect((await directCall(astra, "build", { p_request_id: crypto.randomUUID(), p_territory: enemy.id, p_kind: "port" })).body).toMatchObject({ ok: false, error: "not_your_territory" });

  // S'allier : il faut être deux, et l'alliance se voit.
  await pickTerritory(astra, enemy.name);
  await astra.getByTestId("alliance-propose").click();
  await expect(astra.getByText("Alliance proposée à Brenn")).toBeVisible();
  await brenn.goto("/conquete");
  const requests = brenn.getByTestId("alliance-requests");
  await expect(requests).toContainText("Astra");
  await requests.getByRole("button", { name: "Accepter" }).click();
  await expect(requests).toHaveCount(0);
  await astra.reload();
  await pickTerritory(astra, enemy.name);
  await expect(astra.getByTestId("action-why")).toContainText("votre allié");
  await expect(astra.getByTestId("action-submit")).toHaveCount(0);
  await expect(astra.getByTestId("rank-biggest").getByText("allié")).toBeVisible();
  expect((await directCall(astra, "attack", { p_request_id: crypto.randomUUID(), p_territory: enemy.id, p_troops: 5000 })).body).toMatchObject({ ok: false, error: "ally" });

  // Trahir : il faut confirmer, et tout le monde le voit.
  const betray = astra.getByTestId("alliance-break");
  await betray.click();
  await expect(astra.getByText("Vous avez trahi")).toHaveCount(0);
  await betray.click();
  await expect(astra.getByText("Vous avez trahi Brenn")).toBeVisible();
  await expect(astra.getByTestId("game-feed")).toContainText("Astra a trahi Brenn !");
  await expect(astra.getByTestId("rank-biggest").getByText("traître")).toBeVisible();

  // Le second clic sur la carte lance l'action. Un double-clic par mégarde, non.
  await sql("update public.players set expansions_today = 0");
  const taken = new Set((await sql("select territory_id id from public.territory_state")).map((r) => r["id"] as number));
  const freeLand = byId(astraLands.flatMap((id) => byId(id).neighbours).find((n) => !taken.has(n))!);
  await astra.reload();
  await astra.getByTestId("attack-ratio").fill("100");
  await pickTerritory(astra, freeLand.name);
  await astra.getByTestId("attack-ratio").fill("20");
  await expect(astra.getByTestId("territory-name")).toHaveText(freeLand.name);
  const hex = astra.locator(`.conq-hex[data-t="${freeLand.id}"]`);
  await astra.waitForTimeout(450);
  await hex.click();
  await expect(astra.getByText(`${freeLand.name} est à vous`)).toBeVisible();

  const other = byId(freeLand.neighbours.find((n) => !taken.has(n)) ?? astraLands.flatMap((id) => byId(id).neighbours).find((n) => !taken.has(n) && n !== freeLand.id)!);
  await astra.locator(`.conq-hex[data-t="${other.id}"]`).dblclick();
  await expect(astra.getByTestId("territory-name")).toHaveText(other.name);
  await astra.waitForTimeout(300);
  await expect(astra.getByText(`${other.name} est à vous`)).toHaveCount(0);

  // La bombe : un silo, de l'or, une confirmation. Elle décime sans prendre la terre.
  await brenn.reload();
  await pickTerritory(brenn, enemy.name);
  await brenn.getByTestId("build-silo").click();
  await expect(brenn.getByText("Silo construit")).toBeVisible();
  await sql("update public.territory_state set garrison = 8000 where territory_id = $1", [home.id]);
  await brenn.reload();
  await pickTerritory(brenn, home.name);
  const launch = brenn.getByTestId("bomb-launch");
  await launch.click();
  await launch.click();
  await expect(brenn.getByText(`Bombe tombée sur ${home.name}`)).toBeVisible();
  await expect(brenn.getByTestId("territory-garrison")).toHaveText(fr(2000));
  await expect(brenn.getByTestId("territory-building")).toHaveCount(0);
  await expect(brenn.getByTestId("game-feed")).toContainText(`Brenn a bombardé ${home.name}`);
  await expect(brenn.getByTestId("my-gold")).toHaveText(fr(200_000 - 30_000 - 20_000));

  await accessible(brenn);
  await noOverflow(brenn);
});

test("les rôles se gèrent depuis l'administration, et un officier n'y voit que sa part", async () => {
  await openAdmin(founder, "Membres");
  const row = founder.getByTestId("member-row").filter({ hasText: "Brenn" });
  await row.getByRole("combobox").selectOption("officer");
  await expect(founder.getByText("Rôle de Brenn modifié.")).toBeVisible();

  await brenn.goto("/admin");
  await expect(brenn.getByRole("tab", { name: "Demandes" })).toBeVisible();
  await expect(brenn.getByRole("tab", { name: "Saisons" })).toHaveCount(0);
  await expect(brenn.getByRole("tab", { name: "Journal" })).toHaveCount(0);
  // Masquer un onglet ne protège rien : le serveur refuse aussi.
  expect((await directCall(brenn, "list_admin_log", {})).body).toMatchObject({ ok: false, error: "forbidden" });
  expect((await directCall(brenn, "list_seasons", {})).body).toMatchObject({ ok: false, error: "forbidden" });

  await openAdmin(founder, "Membres");
  await founder.getByTestId("member-row").filter({ hasText: "Brenn" }).getByRole("combobox").selectOption("member");
  await expect(founder.getByText("Rôle de Brenn modifié.")).toBeVisible();
});

test("si le serveur ne répond pas, le jeu le dit : ce n'est pas une carte vide", async () => {
  await visitor.route("**/rest/v1/rpc/**", (r) => r.abort());
  await visitor.goto("/conquete");
  await expect(visitor.getByRole("alert")).toContainText("Jeu indisponible pour l'instant");
  await expect(visitor.getByTestId("season-banner")).toHaveCount(0);
  await visitor.goto("/dons");
  await expect(visitor.getByRole("alert")).toContainText("Classement indisponible pour l'instant");
  await visitor.unroute("**/rest/v1/rpc/**");
  await visitor.getByRole("button", { name: "Réessayer" }).click();
  await expect(visitor.getByTestId("donors-table")).toBeVisible();
});

test("les pages du jeu sont accessibles et tiennent sur téléphone", async () => {
  const pages: [Page, string][] = [
    [visitor, "/conquete"],
    [visitor, "/conquete/regles"],
    [visitor, "/dons"],
    [visitor, "/confidentialite"],
    [astra, "/conquete"],
    [astra, "/compte"],
    [founder, "/admin"],
  ];
  for (const [page, path] of pages) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await accessible(page);
    for (const width of [375, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: 812 });
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  // Toutes les sections de l'administration.
  await founder.goto("/admin");
  for (const tab of ["Dons", "Membres", "Modération", "Saisons", "Journal"]) {
    await founder.getByRole("tab", { name: tab }).click();
    await founder.waitForLoadState("networkidle");
    await accessible(founder);
    await founder.setViewportSize({ width: 375, height: 812 });
    await noOverflow(founder);
    await founder.setViewportSize({ width: 1280, height: 800 });
  }
});

test("les règles sont lisibles par les membres, avec les vrais chiffres", async () => {
  await visitor.goto("/conquete/regles");
  const rules = visitor.getByTestId("rules");
  await expect(rules.getByRole("heading", { name: "Phase 2 : la guerre" })).toBeVisible();
  await expect(rules).toContainText("25 000 troupes");
  await expect(rules).toContainText("aucun hasard");
  await expect(visitor.getByRole("link", { name: "Les donneurs" })).toBeVisible();
});

test("en fin de saison, le classement et la carte sont figés et restent consultables", async () => {
  await openAdmin(founder, "Saisons");
  founder.once("dialog", (d) => void d.accept());
  await founder.getByTestId("close-season").click();
  await expect(founder.getByText("Saison clôturée.")).toBeVisible();

  await visitor.goto("/conquete");
  await expect(visitor.getByTestId("no-season")).toBeVisible();
  const history = visitor.getByTestId("season-history");
  await expect(history).toContainText("Saison 1");
  await expect(history).toContainText("Conquérant : Astra");
  await history.getByRole("button", { name: "Voir la carte finale" }).click();

  const closed = visitor.getByTestId("closed-season");
  await expect(closed).toContainText("carte figée");
  await expect(closed.getByTestId("final-biggest")).toContainText("Astra");
  await expect(closed.getByTestId("final-conquerors")).toContainText("Astra");
  await expect(closed.getByTestId("final-donors")).toContainText("Astra");
  // La carte figée garde les couleurs et les noms de ses propriétaires.
  const owner = await closed.locator(`[data-t="${byName("Paris").id}"]`).getAttribute("data-owner");
  expect(owner).toBeTruthy();
  await expect(closed.locator(`.conq-owner[data-owner="${owner}"]`)).toHaveAttribute("style", /fill/);
  await expect(closed.getByTestId("owner-labels").locator(`[data-owner="${owner}"]`)).toContainText("Astra");
  await expect(visitor.getByTestId("action-panel")).toHaveCount(0);

  // Plus aucune action possible, même en appelant le serveur directement.
  const res = await directCall(astra, "reinforce", { p_request_id: crypto.randomUUID(), p_territory: byName("Paris").id, p_troops: 1 });
  expect(res.body).toMatchObject({ ok: false, error: "no_active_season" });
});

test("le jour où OpenFront donne un accès, les dons se lisent tout seuls et remplacent les déclarations", async () => {
  // La collecte, avec la clé de service, envoie ce qu'elle a lu chez OpenFront.
  const past = new Date(Date.now() - 86_400_000).toISOString();
  expect(await service("ingest_openfront_donations", { p_rows: [{ id: "9001", hash: hash("PUB-ASTRA"), capsules: 12_345, at: past }, { id: "9002", hash: hash("PUB-ANON"), capsules: 7, at: past }] })).toMatchObject({ ok: true, new: 2 });

  await astra.goto("/compte");
  await expect(astra.getByTestId("my-capsules")).toHaveText(fr(12_345));
  await expect(astra.getByTestId("declare-form")).toHaveCount(0);
  await expect(astra.getByTestId("my-donations")).toContainText("lues chez OpenFront");
  // Même en appelant le serveur directement, plus rien ne se déclare.
  expect((await directCall(astra, "declare_donation", { p_request_id: crypto.randomUUID(), p_capsules: 5, p_donated_on: new Date().toISOString().slice(0, 10) })).body).toMatchObject({ ok: false, error: "donations_synced" });

  await visitor.goto("/dons");
  await expect(visitor.getByTestId("donors-read-at")).toContainText("Dons lus chez OpenFront");
  await expect(visitor.getByTestId("donor-row").first()).toContainText(fr(12_345));

  await openAdmin(founder, "Dons");
  await expect(founder.getByTestId("admin-donations")).toContainText("lus directement chez OpenFront");
  await expect(founder.getByTestId("enter-donation")).toHaveCount(0);
});

test("effacer son compte supprime ses données, tout de suite", async () => {
  await brenn.goto("/compte");
  brenn.once("dialog", (d) => void d.accept());
  await brenn.getByRole("button", { name: "Effacer mon compte" }).click();
  await brenn.waitForURL(/\/$/);
  expect(await sql("select 1 from public.profiles where display_name = 'Brenn'")).toEqual([]);
  expect(await sql("select 1 from auth.users where raw_user_meta_data ->> 'full_name' = 'BrennDiscord'")).toEqual([]);
});


/* ---------- Une nouvelle saison, pour des joueurs qui découvrent le jeu ---------- */

const CONFIG = JSON.parse(readFileSync("config/conquete.json", "utf8")) as Record<string, unknown>;
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true };
let seasonId = 0;
let cador: Page;
let divico: Page;

/** Un nouveau membre, déjà validé, qui n'a encore jamais ouvert le jeu. */
async function newcomer(browser: Browser, name: string, baseURL: string | undefined, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const page = await signIn(browser, name, baseURL, options);
  watch(page, name);
  await sql("update public.profiles set status = 'validated', validated_at = now(), display_name = $1 where user_id = (select id from auth.users where raw_user_meta_data ->> 'full_name' = $1)", [name]);
  return page;
}
const selectedHex = async (page: Page) => Number(await page.locator(".conq-hex.is-selected").getAttribute("data-t"));
/** Sans forcer : un panneau posé sur la terre visée ferait échouer ce clic, comme il bloquerait un vrai joueur. */
const clickHex = async (page: Page, id: number) => {
  // Le second clic doit venir après le délai qui écarte les doubles-clics.
  await page.waitForTimeout(450);
  await page.locator(`.conq-hex[data-t="${id}"]`).click({ timeout: 5000 });
};
const landsOfPlayer = async (name: string) => (await sql("select s.territory_id id from public.territory_state s join public.profiles p on p.user_id = s.owner_id where s.season_id = $1 and p.display_name = $2 order by s.territory_id", [seasonId, name])).map((r) => r["id"] as number);
const freeLands = async () => {
  const taken = new Set((await sql("select territory_id id from public.territory_state where season_id = $1", [seasonId])).map((r) => r["id"] as number));
  return MAP.territories.filter((t) => !taken.has(t.id));
};
const giveLands = (name: string, lands: number[], garrison = 2000) =>
  sql("insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) select $1, x, (select user_id from public.profiles where display_name = $2), $4, now() - interval '1 day' from unnest($3::int[]) x", [seasonId, name, lands, garrison]);

test("le guide accompagne une vraie première partie, étape par étape, et rien ne se perd en rechargeant", async ({ browser, baseURL }) => {
  // Le jeu relit la partie toutes les 15 secondes : ce parcours attend ces relectures.
  test.setTimeout(90_000);
  const created = await directCall(founder, "create_season", { p_name: "Saison du guide", p_config: CONFIG });
  expect(created.body).toMatchObject({ ok: true });
  seasonId = created.body["id"] as number;
  expect((await directCall(founder, "start_season", { p_season: seasonId })).body).toMatchObject({ ok: true });

  cador = await newcomer(browser, "Cador", baseURL);
  await cador.goto("/conquete");
  const guide = cador.getByTestId("guide");
  const title = cador.getByTestId("guide-title");
  const next = cador.getByTestId("guide-primary");
  const arena = cador.getByTestId("arena");

  // L'accueil : le but du jeu, et une porte de sortie.
  await expect(title).toHaveText("Bienvenue dans la Conquête");
  await expect(cador.getByTestId("guide-progress")).toContainText("étape 1 sur");
  await expect(guide).toContainText("tenir 80 % de la carte");
  await expect(cador.getByTestId("guide-skip")).toBeVisible();
  await accessible(cador);
  await next.click();

  // Choisir sa terre : le guide en conseille, et peut en proposer une.
  await expect(title).toHaveText("Choisissez votre terre de départ");
  await expect(cador.locator(".conq-hex.is-suggested")).toHaveCount(3);
  await expect(guide).toContainText("1 600 troupes par plaine".replace(" ", " "));
  await expect(cador.getByTestId("action-panel")).toContainText("Rien ne part avant que vous ayez confirmé");
  await next.click();
  await expect(title).toContainText("Installez-vous à");
  await expect(arena).toHaveAttribute("data-guide-spot", "action");
  await expect(cador.locator(".conq-hex.is-suggested")).toHaveCount(0);
  const start = await selectedHex(cador);
  expect(byId(start).terrain).toBe("plains");
  await accessible(cador);

  // Le second clic n'engage pas sa terre de départ : seul le bouton le fait.
  await clickHex(cador, start);
  await cador.waitForTimeout(300);
  expect(await landsOfPlayer("Cador")).toEqual([]);
  await cador.getByTestId("action-submit").click();
  await expect(cador.getByText("Vous vous installez")).toBeVisible();

  // Les ressources, avec ses vrais chiffres.
  await expect(title).toHaveText("Vos ressources");
  await expect(arena).toHaveAttribute("data-guide-spot", "command");
  await next.click();

  // Conquérir : le guide propose la moins chère, le panneau montre le prix, le second clic part.
  await expect(title).toHaveText("Conquérez une terre voisine");
  await next.click();
  await expect(guide).toContainText("cliquez encore sur la terre");
  const target = await selectedHex(cador);
  expect(byId(start).neighbours).toContain(target);
  await expect(cador.getByTestId("action-preview")).toContainText("Le terrain coûte");
  await clickHex(cador, target);
  await expect(cador.getByText(`${byId(target).name} est à vous`)).toBeVisible();

  // Le ratio, avec ce que vaut la réserve en ce moment.
  await expect(title).toHaveText("Le ratio d'attaque");
  await expect(arena).toHaveAttribute("data-guide-spot", "ratio");
  await next.click();

  // Renforcer : réussir l'action fait avancer le guide.
  await expect(title).toHaveText("Renforcez une terre");
  await act(cador, 500);
  await expect(cador.getByText("compte maintenant")).toBeVisible();

  // Rien ne se perd en rechargeant.
  await expect(title).toHaveText("Construisez votre premier bâtiment");
  await cador.reload();
  await expect(title).toHaveText("Construisez votre premier bâtiment");
  await next.click();
  await expect(cador.getByTestId("build-menu")).toBeVisible();
  await expect(arena).toHaveAttribute("data-guide-spot", "build");
  await cador.getByTestId("build-post").click();
  await expect(cador.getByText("Poste de défense construit")).toBeVisible();

  // La suite : il annonce la guerre, sans l'expliquer avant l'heure.
  await expect(title).toHaveText("Et maintenant ?");
  await expect(guide).toContainText("Ce guide reviendra à ce moment-là");
  await next.click();
  await expect(title).toHaveText("Vous êtes prêt !");
  await expect(guide).toContainText("Rien ne vous oblige à donner");
  await expect(guide.getByRole("link", { name: "Lire les règles" })).toHaveAttribute("href", /conquete\/regles/);
  await accessible(cador);
  await next.click();
  await expect(guide).toHaveCount(0);
  await cador.reload();
  await expect(cador.getByTestId("guide-open")).toBeVisible();
  await expect(guide).toHaveCount(0);

  // On peut le revoir : les explications repassent, ce qui est fait reste derrière.
  await cador.getByTestId("guide-open").click();
  await expect(title).toHaveText("Vos ressources");
  await cador.getByTestId("guide-close").click();
  await expect(guide).toHaveCount(0);
  await cador.reload();
  await expect(cador.getByTestId("guide-open")).toBeVisible();
  await expect(guide).toHaveCount(0);
  await cador.getByTestId("guide-open").click();
  for (let i = 0; i < 12 && (await guide.count()) > 0; i++) {
    const later = cador.getByTestId("guide-later");
    await (await later.count() ? later : next).click();
  }
  await expect(guide).toHaveCount(0);
});

test("le guide revient à la guerre, et ses alertes préviennent le joueur attaqué, même absent", async ({ browser, baseURL }) => {
  // Le jeu relit la partie toutes les 15 secondes : ce parcours attend ces relectures.
  test.setTimeout(180_000);
  // Divico s'installe à côté de Cador, et préfère se débrouiller sans guide.
  divico = await newcomer(browser, "Divico", baseURL);
  await divico.goto("/conquete");
  await divico.getByTestId("guide-skip").click();
  await expect(divico.getByTestId("guide")).toHaveCount(0);
  const cadorLands = await landsOfPlayer("Cador");
  const free = new Set((await freeLands()).map((t) => t.id));
  const next = cadorLands.flatMap((id) => byId(id).neighbours).filter((n) => free.has(n));
  const home = next[0]!;
  await pickTerritory(divico, byId(home).name);
  await act(divico, 2000);
  await expect(divico.getByText("Vous vous installez")).toBeVisible();
  const others = [...new Set(next)].filter((n) => n !== home).slice(0, 2);
  await giveLands("Divico", others);
  await sql("update public.players set troops = 60000, troops_at = now()");

  // La guerre est déclarée : le guide revient seul, et tout le monde est prévenu, sans recharger.
  await divico.reload();
  await expect(divico.getByTestId("command-bar")).toBeVisible();
  expect((await directCall(founder, "set_war_date", { p_season: seasonId, p_at: new Date().toISOString() })).body).toMatchObject({ ok: true });
  await expect(divico.getByTestId("game-notices")).toContainText("La guerre commence", { timeout: 20_000 });
  const title = cador.getByTestId("guide-title");
  await expect(title).toHaveText("La guerre : attaquez un voisin", { timeout: 20_000 });

  // Une terre tout juste prise est protégée : l'écran ne promet pas une victoire impossible.
  await pickTerritory(cador, byId(home).name);
  await cador.getByTestId("action-amount").fill("30000");
  await expect(cador.getByTestId("action-preview")).toContainText("une attaque serait refusée");
  await expect(cador.getByTestId("action-preview")).not.toContainText("Victoire prévue");

  await sql("update public.territory_state set protected_until = null");
  await cador.reload();
  await expect(title).toHaveText("La guerre : attaquez un voisin");
  await cador.getByTestId("guide-primary").click();
  // Le guide propose une terre de Divico à sa portée, la plus faible.
  const target = await selectedHex(cador);
  expect(await landsOfPlayer("Divico")).toContain(target);
  await expect(cador.getByTestId("guide")).toContainText("Si la victoire est annoncée");

  // Une attaque annoncée perdante ne part pas sur un second clic : seul le bouton la lance.
  await cador.getByTestId("attack-ratio").fill("1");
  await expect(cador.getByTestId("action-preview")).toContainText("Échec prévu");
  await expect(cador.getByTestId("action-panel")).toContainText("seul ce bouton la lance");
  await clickHex(cador, target);
  await cador.waitForTimeout(400);
  expect((await sql("select attacks_today a from public.players p join public.profiles u on u.user_id = p.user_id where p.season_id = $1 and u.display_name = 'Cador'", [seasonId]))[0]!["a"]).toBe(0);

  // Annoncée gagnante, elle part.
  await cador.getByRole("button", { name: /Juste assez/ }).click();
  await expect(cador.getByTestId("action-preview")).toContainText("Victoire prévue");
  await expect(cador.getByTestId("action-panel")).toContainText("ou cliquez encore sur la terre");
  await clickHex(cador, target);
  await expect(cador.getByText(`Victoire ! ${byId(target).name} est à vous`)).toBeVisible();
  await expect(title).toHaveText("Alliés et traîtres");

  // Le joueur attaqué l'apprend sur sa carte, sans recharger. La mauvaise nouvelle attend qu'il l'ait lue.
  const notices = divico.getByTestId("game-notices");
  await expect(notices).toContainText(`Cador vous a pris ${byId(target).name}`, { timeout: 20_000 });
  await divico.waitForTimeout(13_000);
  const taken = notices.locator(".conq-notice").filter({ hasText: "Cador vous a pris" });
  await expect(taken).toBeVisible();
  await taken.getByRole("button", { name: "Voir" }).click();
  await expect(divico.getByTestId("territory-name")).toHaveText(byId(target).name);
  await taken.getByRole("button", { name: "Fermer cette annonce" }).click();
  await expect(taken).toHaveCount(0);
  await accessible(divico);

  // Une alliance proposée arrive aussi sans recharger, alors qu'elle n'écrit rien dans le fil.
  const stillTheirs = async () => {
    const held = new Set(await landsOfPlayer("Cador"));
    return (await landsOfPlayer("Divico")).find((id) => byId(id).neighbours.some((n) => held.has(n)))!;
  };
  await pickTerritory(cador, byId(await stillTheirs()).name);
  await cador.getByTestId("alliance-propose").click();
  await expect(cador.getByText("Alliance proposée à Divico")).toBeVisible();
  await expect(divico.getByTestId("alliance-requests")).toContainText("Cador", { timeout: 20_000 });
  await expect(notices).toContainText("Cador vous propose une alliance");
  await divico.getByTestId("alliance-requests").getByRole("button", { name: "Refuser" }).click();
  await expect(divico.getByTestId("alliance-requests")).toHaveCount(0);

  // Absent, il l'apprend à son retour : ce qui le touche, pas tout le reste.
  await divico.goto("about:blank");
  await sql("update public.players set last_attack_at = null, troops = 60000, troops_at = now()");
  await sql("update public.territory_state set protected_until = null");
  const last = await stillTheirs();
  await giveLands("Divico", (await freeLands()).slice(0, 3).map((t) => t.id));
  await cador.reload();
  await pickTerritory(cador, byId(last).name);
  await cador.getByRole("button", { name: /Juste assez/ }).click();
  await cador.getByTestId("action-submit").click();
  await expect(cador.getByText(`Victoire ! ${byId(last).name} est à vous`)).toBeVisible();
  await divico.goto("/conquete");
  await expect(divico.getByTestId("game-notices")).toContainText(`Cador vous a pris ${byId(last).name}`);
});

test("les commandes : un geste qui finit hors de la carte, la molette, et les listes sous la carte", async () => {
  // Le jeu relit la partie toutes les 15 secondes : ce parcours attend ces relectures.
  test.setTimeout(60_000);
  await cador.reload();
  await expect(cador.getByTestId("command-bar")).toBeVisible();
  await cador.getByRole("button", { name: "Vue d'ensemble" }).click();
  await cador.evaluate(() => scrollTo(0, 0));
  const group = cador.locator(".conq-map-view svg > g");
  const svg = cador.locator(".conq-map-view svg");
  const box = (await svg.boundingBox())!;
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 3 };

  // La molette zoome tant qu'on n'est pas au plus large, sans faire défiler la page.
  await cador.mouse.move(middle.x, middle.y);
  await cador.mouse.wheel(0, -200);
  await expect(svg).toHaveAttribute("data-zoomed", "true");
  expect(await cador.evaluate(() => scrollY)).toBe(0);

  // Un glisser relâché au-dessus d'un panneau se termine bel et bien.
  const panel = (await cador.getByTestId("action-panel").boundingBox())!;
  await cador.mouse.move(middle.x, middle.y);
  await cador.mouse.down();
  await cador.mouse.move(middle.x + 30, middle.y + 10, { steps: 3 });
  await cador.mouse.move(panel.x + 20, panel.y + 20, { steps: 3 });
  await cador.mouse.up();
  const released = await group.getAttribute("transform");
  await cador.mouse.move(middle.x - 80, middle.y + 40, { steps: 4 });
  await cador.mouse.move(middle.x - 160, middle.y + 80, { steps: 4 });
  expect(await group.getAttribute("transform"), "la carte ne suit pas la souris sans bouton").toBe(released);

  // Au plus large, la molette rend la main à la page : le fil et les classements restent accessibles.
  await cador.getByRole("button", { name: "Vue d'ensemble" }).click();
  await cador.mouse.move(middle.x, middle.y);
  await cador.mouse.wheel(0, 500);
  await expect.poll(() => cador.evaluate(() => scrollY)).toBeGreaterThan(0);
  await cador.mouse.wheel(0, -500);
  await expect.poll(() => cador.evaluate(() => scrollY)).toBe(0);
  await expect(svg).toHaveAttribute("data-zoomed", "false");

  // Choisir dans la liste du bas ramène au panneau, et le clavier suit.
  const select = cador.getByTestId("territory-select");
  await select.scrollIntoViewIfNeeded();
  await select.selectOption({ label: "Tokyo" });
  const name = cador.getByTestId("territory-name");
  await expect(name).toHaveText("Tokyo");
  await expect(name).toBeFocused();
  await expect.poll(async () => (await name.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((await name.boundingBox())!.y).toBeLessThan(800);

  // Parcourir la liste au clavier n'en arrache pas le joueur, et Entrée y va.
  await select.focus();
  await cador.keyboard.press("ArrowDown");
  await expect(select).toBeFocused();
  await cador.keyboard.press("Enter");
  await expect(name).toBeFocused();

  // Fermer le panneau d'une terre, puis retrouver son classement complet sous la carte.
  await cador.getByTestId("territory-close").click();
  await expect(name).toHaveCount(0);
  await expect(cador.getByTestId("rank-biggest-all")).toContainText("Cador");
  await expect(cador.getByRole("link", { name: "Fil et classements" })).toHaveAttribute("href", "#conq-details");

  // Le dernier territoire d'un joueur : l'écran ne promet pas ce que le serveur refuserait.
  const lonely = await landsOfPlayer("Divico");
  const keep = lonely.find((id) => (byId(id).neighbours as number[]).some((n) => n !== id)) ?? lonely[0]!;
  await sql("delete from public.territory_state where season_id = $1 and territory_id = any($2::int[])", [seasonId, lonely.filter((id) => id !== keep)]);
  await sql("update public.territory_state set protected_until = null");
  const mine = await landsOfPlayer("Cador");
  if (!byId(keep).neighbours.some((n) => mine.includes(n))) await giveLands("Cador", byId(keep).neighbours.slice(0, 1).filter((n) => !mine.includes(n)));
  await cador.reload();
  await pickTerritory(cador, byId(keep).name);
  await expect(cador.getByTestId("action-preview")).toContainText("dernier territoire");
  await expect(cador.getByTestId("action-preview")).not.toContainText("Victoire prévue");
});

test("au téléphone : le guide au-dessus de la carte, et un toucher qui ouvre le panneau sans défiler", async ({ browser, baseURL }) => {
  // Le jeu relit la partie toutes les 15 secondes : ce parcours attend ces relectures.
  test.setTimeout(60_000);
  const phone = await newcomer(browser, "Eporedorix", baseURL, PHONE);
  await phone.goto("/conquete");
  const guide = phone.getByTestId("guide");
  await expect(guide).toBeVisible();
  const card = (await guide.boundingBox())!;
  const map = (await phone.locator(".conq-map-view svg").boundingBox())!;
  expect(card.y + card.height, "le guide se lit avant la carte").toBeLessThanOrEqual(map.y);
  await noOverflow(phone);
  await accessible(phone);

  await phone.getByTestId("guide-primary").tap();
  await expect(phone.getByTestId("guide-title")).toHaveText("Choisissez votre terre de départ");
  await phone.getByTestId("guide-primary").tap();
  await expect(phone.getByTestId("guide-title")).toContainText("Installez-vous à");

  // Le panneau monte du bas de l'écran : confirmer se fait sans défiler.
  const submit = phone.getByTestId("action-submit");
  await expect(submit).toBeInViewport({ ratio: 1 });
  await noOverflow(phone);
  await accessible(phone);
  await submit.tap();
  await expect(phone.getByText("Vous vous installez")).toBeVisible();

  // Le panneau se referme, et la carte est là.
  await phone.getByTestId("territory-close").tap();
  await expect(phone.getByTestId("territory-name")).toHaveCount(0);
  await expect(phone.getByTestId("guide-title")).toHaveText("Vos ressources");

  // Au retour, la carte s'ouvre sur ses terres : à l'échelle du monde, on ne pourrait rien toucher.
  await phone.reload();
  await expect(phone.getByTestId("command-bar")).toBeAttached();
  await expect(phone.locator(".conq-map-view svg")).toHaveAttribute("data-zoomed", "true");

  // Toucher une terre ouvre le panneau, à l'écran. On attend d'abord la fin du défilement qui amène la barre de commande.
  await phone.waitForTimeout(900);
  const svg = (await phone.locator(".conq-map-view svg").boundingBox())!;
  await phone.touchscreen.tap(svg.x + svg.width / 2, svg.y + svg.height / 2);
  await expect(phone.getByTestId("territory-name")).toBeInViewport();
  await noOverflow(phone);
  await phone.context().close();
});

test("un joueur qui tient déjà plusieurs terres n'est pas interrompu par le guide", async ({ browser, baseURL }) => {
  const veteran = await newcomer(browser, "Vercassivellaunos", baseURL);
  const [{ u } = { u: "" }] = (await sql("select user_id u from public.profiles where display_name = 'Vercassivellaunos'")) as { u: string }[];
  await sql("insert into public.players (season_id, user_id, troops, troops_at, counters_day, gold) values ($1, $2, 50000, now(), current_date, 5000)", [seasonId, u]);
  await giveLands("Vercassivellaunos", (await freeLands()).slice(0, 3).map((t) => t.id));
  await veteran.goto("/conquete");
  await expect(veteran.getByTestId("guide-open")).toBeVisible();
  await expect(veteran.getByTestId("guide")).toHaveCount(0);
  await veteran.context().close();
});

test("la victoire se voit : le vainqueur est nommé, pour lui et pour ceux qui regardent", async () => {
  // Le jeu relit la partie toutes les 15 secondes : ce parcours attend ces relectures.
  test.setTimeout(60_000);
  await sql("update public.territory_state set protected_until = null");
  await sql("update public.players set expansions_today = 0, troops = 200000, troops_at = now()");
  const lands = await landsOfPlayer("Cador");
  const free = await freeLands();
  const final = lands.flatMap((id) => byId(id).neighbours).find((n) => free.some((t) => t.id === n))!;
  const needed = Math.ceil(MAP.territories.length * (CONFIG["victoryShare"] as number));
  const others = free.filter((t) => t.id !== final).slice(0, needed - lands.length - 1).map((t) => t.id);
  await giveLands("Cador", others);
  await divico.goto("/conquete");
  await expect(divico.getByTestId("arena")).toBeVisible();
  await cador.reload();
  await pickTerritory(cador, byId(final).name);
  await act(cador, 5000);

  const last = cador.getByTestId("last-season");
  await expect(last).toContainText("« Saison du guide » est terminée");
  await expect(last).toContainText("Cador l'a remportée");
  await expect(divico.getByTestId("last-season")).toContainText("Cador l'a remportée", { timeout: 20_000 });
  await expect(divico.getByTestId("season-history")).toContainText("Vainqueur : Cador");
  await divico.getByTestId("last-season-map").click();
  await expect(divico.getByTestId("closed-season")).toContainText("Vainqueur : Cador");
  await accessible(divico);
});
