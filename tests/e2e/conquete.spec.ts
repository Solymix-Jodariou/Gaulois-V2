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

const API = "http://127.0.0.1:54399";
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
async function signIn(browser: Browser, name: string, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:4322", viewport: { width: 1280, height: 800 } });
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
  // 10 000 capsules : 25 % de (100 000 + 2000 × 100).
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(75_000));
  await pickTerritory(astra, "Paris");
  await expect(astra.getByTestId("territory-name")).toHaveText("Paris");
  await expect(astra.getByTestId("action-preview")).toContainText("Le premier territoire est gratuit");
  await act(astra, 5000);
  await expect(astra.getByText("Vous vous installez à Paris")).toBeVisible();
  await expect(astra.getByTestId("my-troops")).toHaveText(fr(70_000));
  await expect(astra.getByTestId("game-feed").locator("li").first()).toContainText("Astra s'installe à Paris.");

  // La carte prend la couleur du joueur.
  const paris = astra.locator(`[data-t="${byName("Paris").id}"]`);
  await expect(paris).toHaveClass(/is-mine/);

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
  await expect(closed.locator(`[data-t="${byName("Paris").id}"]`)).toHaveAttribute("style", /fill/);
  await expect(visitor.getByTestId("action-panel")).toHaveCount(0);

  // Plus aucune action possible, même en appelant le serveur directement.
  const res = await directCall(astra, "reinforce", { p_request_id: crypto.randomUUID(), p_territory: byName("Paris").id, p_troops: 1 });
  expect(res.body).toMatchObject({ ok: false, error: "no_active_season" });
});

test("effacer son compte supprime ses données, tout de suite", async () => {
  await brenn.goto("/compte");
  brenn.once("dialog", (d) => void d.accept());
  await brenn.getByRole("button", { name: "Effacer mon compte" }).click();
  await brenn.waitForURL(/\/$/);
  expect(await sql("select 1 from public.profiles where display_name = 'Brenn'")).toEqual([]);
  expect(await sql("select 1 from auth.users where raw_user_meta_data ->> 'full_name' = 'BrennDiscord'")).toEqual([]);
});
