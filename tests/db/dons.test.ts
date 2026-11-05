import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ANON, SERVICE, TestDb, asUser, withRole } from "../support/database";

let db: TestDb;
let officer: string;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  officer = await db.addMember("OfficierDons", "officer");
});
afterAll(() => db.close());

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
const dayOffset = (days: number) => new Date(Date.parse(`${today()}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const declare = (user: string, capsules: number, extra: Record<string, unknown> = {}) =>
  db.rpc<{ ok: boolean; id: number; error?: string }>(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: capsules, p_donated_on: today(), ...extra });
const review = (who: string, id: number, approve: boolean, reason?: string) => db.rpc(asUser(who), "review_donation", { p_donation: id, p_approve: approve, p_reason: reason });
const capsulesOf = async (user: string) => Number((await db.sql<{ c: string }>("select capsules_total c from public.profiles where user_id = $1", [user]))[0]!.c);

describe("déclarer un don", () => {
  it("n'ajoute rien tant qu'un officier n'a pas validé : seul un don validé compte", async () => {
    const member = await db.addMember("Donneur1");
    const res = await declare(member, 500, { p_note: "Don de ce soir" });
    expect(res).toMatchObject({ ok: true });
    expect(await capsulesOf(member)).toBe(0);
    const mine = await db.rpc<{ rows: { capsules: number; status: string; note: string }[]; total: number }>(asUser(member), "get_my_donations");
    expect(mine.rows[0]).toMatchObject({ capsules: 500, status: "pending", note: "Don de ce soir" });
    expect(mine.total).toBe(0);

    expect(await review(officer, res.id, true)).toMatchObject({ ok: true });
    expect(await capsulesOf(member)).toBe(500);
    expect(await db.rpc(asUser(member), "get_me")).toMatchObject({ capsules: 500 });
  });

  it("un don refusé ne compte jamais, et le membre voit la raison", async () => {
    const member = await db.addMember("Donneur2");
    const res = await declare(member, 500);
    expect(await review(officer, res.id, false, "Introuvable dans l'onglet Dons")).toMatchObject({ ok: true });
    expect(await capsulesOf(member)).toBe(0);
    const mine = await db.rpc<{ rows: { status: string; reason: string }[] }>(asUser(member), "get_my_donations");
    expect(mine.rows[0]).toMatchObject({ status: "refused", reason: "Introuvable dans l'onglet Dons" });
  });

  it("refuse les montants et les dates absurdes", async () => {
    const member = await db.addMember("Donneur3");
    for (const capsules of [0, -5, 1_000_000_001]) expect(await declare(member, capsules)).toMatchObject({ ok: false, error: "invalid_capsules" });
    expect(await declare(member, 10, { p_donated_on: dayOffset(2) })).toMatchObject({ ok: false, error: "invalid_date" });
    expect(await declare(member, 10, { p_donated_on: dayOffset(-400) })).toMatchObject({ ok: false, error: "invalid_date" });
    expect(await declare(member, 10, { p_note: "x".repeat(301) })).toMatchObject({ ok: false, error: "invalid_note" });
  });

  it("réservé aux membres validés", async () => {
    const pending = await db.addUser("Attente");
    expect(await declare(pending, 100)).toMatchObject({ ok: false, error: "not_validated" });
    await expect(db.rpc(ANON, "declare_donation", { p_request_id: randomUUID(), p_capsules: 100, p_donated_on: today() })).rejects.toMatchObject({ code: "42501" });
  });

  it("une même demande envoyée deux fois n'enregistre qu'un don, même en même temps", async () => {
    const member = await db.addMember("Donneur4");
    const request = randomUUID();
    const send = () => db.rpc<{ ok: boolean; id: number }>(asUser(member), "declare_donation", { p_request_id: request, p_capsules: 42, p_donated_on: today() });
    const results = await Promise.all([send(), send(), send(), send(), send()]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const [row] = await db.sql<{ n: string }>("select count(*) n from public.donations where user_id = $1", [member]);
    expect(Number(row!.n)).toBe(1);
  });

  it("limite les déclarations en attente", async () => {
    const member = await db.addMember("Donneur5");
    for (let i = 0; i < 20; i++) expect(await declare(member, 1)).toMatchObject({ ok: true });
    expect(await declare(member, 1)).toMatchObject({ ok: false, error: "too_many_pending" });
  });
});

describe("la capture facultative", () => {
  const upload = (user: string, name: string) =>
    withRole(db.pool, asUser(user), (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('donation-proofs', $1, $2)", [name, user]));

  it("va dans le dossier de son auteur, et personne d'autre ne l'y dépose", async () => {
    const a = await db.addMember("CaptureA");
    const b = await db.addMember("CaptureB");
    await upload(a, `${a}/preuve.png`);
    await expect(upload(a, `${b}/faux.png`)).rejects.toMatchObject({ code: "42501" });
    const pending = await db.addUser("CaptureAttente");
    await expect(upload(pending, `${pending}/x.png`)).rejects.toMatchObject({ code: "42501" });
  });

  it("reste privée : ni un autre membre ni un visiteur ne la lit, un officier si", async () => {
    const a = await db.addMember("CaptureC");
    const b = await db.addMember("CaptureD");
    await upload(a, `${a}/preuve.png`);
    const count = (who: string) => withRole(db.pool, asUser(who), async (c) => (await c.query("select name from storage.objects where bucket_id = 'donation-proofs' and name = $1", [`${a}/preuve.png`])).rowCount);
    expect(await count(a)).toBe(1);
    expect(await count(officer)).toBe(1);
    expect(await count(b)).toBe(0);
    await expect(withRole(db.pool, ANON, (c) => c.query("select * from storage.objects"))).rejects.toMatchObject({ code: "42501" });
  });

  it("une déclaration ne peut pas citer le fichier de quelqu'un d'autre, ni un fichier absent", async () => {
    const a = await db.addMember("CaptureE");
    const b = await db.addMember("CaptureF");
    await upload(b, `${b}/sienne.png`);
    expect(await declare(a, 10, { p_screenshot_path: `${b}/sienne.png` })).toMatchObject({ ok: false, error: "invalid_screenshot" });
    expect(await declare(a, 10, { p_screenshot_path: `${a}/absente.png` })).toMatchObject({ ok: false, error: "invalid_screenshot" });
  });

  it("est effacée après la décision", async () => {
    const a = await db.addMember("CaptureG");
    await upload(a, `${a}/preuve.png`);
    const res = await declare(a, 10, { p_screenshot_path: `${a}/preuve.png` });
    expect(res).toMatchObject({ ok: true });
    const list = await db.rpc<{ rows: { id: number; screenshot_path: string | null; can_review: boolean }[] }>(asUser(officer), "list_donations");
    expect(list.rows.find((r) => r.id === res.id)).toMatchObject({ screenshot_path: `${a}/preuve.png`, can_review: true });

    expect(await review(officer, res.id, true)).toMatchObject({ ok: true, removed_path: `${a}/preuve.png` });
    const [row] = await db.sql<{ screenshot_path: string | null }>("select screenshot_path from public.donations where id = $1", [res.id]);
    expect(row!.screenshot_path).toBeNull();
    const queue = await db.rpc<{ paths: string[] }>(SERVICE, "list_file_cleanup");
    expect(queue.paths).toContain(`${a}/preuve.png`);
    await db.rpc(SERVICE, "confirm_file_cleanup", { p_paths: [`${a}/preuve.png`] });
    await db.sql("delete from storage.objects where name = $1", [`${a}/preuve.png`]);
    expect((await db.rpc<{ paths: string[] }>(SERVICE, "list_file_cleanup")).paths).not.toContain(`${a}/preuve.png`);
  });

  it("un fichier oublié depuis plus d'un jour part aussi à l'effacement", async () => {
    const a = await db.addMember("CaptureH");
    await upload(a, `${a}/oubli.png`);
    await db.sql("update storage.objects set created_at = now() - interval '2 days' where name = $1", [`${a}/oubli.png`]);
    expect((await db.rpc<{ paths: string[] }>(SERVICE, "list_file_cleanup")).paths).toContain(`${a}/oubli.png`);
    await expect(db.rpc(asUser(a), "list_file_cleanup")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("l'officier", () => {
  it("ne valide pas ses propres dons, et un simple membre ne valide rien", async () => {
    const res = await declare(officer, 100);
    expect(await review(officer, res.id, true)).toMatchObject({ ok: false, error: "not_on_yourself" });
    const member = await db.addMember("Simple");
    expect(await review(member, res.id, true)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(member), "list_donations")).toMatchObject({ ok: false, error: "forbidden" });
    const other = await db.addMember("AutreOfficier", "officer");
    expect(await review(other, res.id, true)).toMatchObject({ ok: true });
    await db.sql("update public.profiles set capsules_total = 0 where user_id = $1", [officer]);
  });

  it("une décision ne se prend qu'une fois", async () => {
    const member = await db.addMember("Donneur6");
    const res = await declare(member, 100);
    await review(officer, res.id, true);
    expect(await review(officer, res.id, true)).toMatchObject({ ok: false, error: "donation_closed" });
    expect(await capsulesOf(member)).toBe(100);
  });

  it("deux validations simultanées du même don ne comptent qu'une fois", async () => {
    const member = await db.addMember("Donneur7");
    const res = await declare(member, 100);
    const results = await Promise.all(Array.from({ length: 6 }, () => review(officer, res.id, true)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await capsulesOf(member)).toBe(100);
  });

  it("saisit un don ou un total de départ directement, sous sa responsabilité", async () => {
    const member = await db.addMember("Donneur8");
    const send = (extra: Record<string, unknown>) => db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: member, p_capsules: 1000, p_donated_on: today(), ...extra });
    expect(await send({ p_kind: "opening", p_note: "Relevé dans Top donateurs" })).toMatchObject({ ok: true });
    expect(await send({})).toMatchObject({ ok: true });
    expect(await capsulesOf(member)).toBe(2000);
    const log = await db.sql("select * from public.admin_log where action = 'donation_entered' and target_id = $1", [member]);
    expect(log).toHaveLength(2);

    expect(await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: officer, p_capsules: 1, p_donated_on: today() })).toMatchObject({ ok: false, error: "not_on_yourself" });
    const simple = await db.addMember("Simple2");
    expect(await db.rpc(asUser(simple), "enter_donation", { p_request_id: randomUUID(), p_user: member, p_capsules: 1, p_donated_on: today() })).toMatchObject({ ok: false, error: "forbidden" });
    const pending = await db.addUser("Attente2");
    expect(await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: pending, p_capsules: 1, p_donated_on: today() })).toMatchObject({ ok: false, error: "target_not_validated" });
  });

  it("annule un don validé par erreur : il ne compte plus, et la trace reste", async () => {
    const member = await db.addMember("Donneur9");
    const res = await declare(member, 300);
    await review(officer, res.id, true);
    expect(await db.rpc(asUser(officer), "cancel_donation", { p_donation: res.id, p_reason: "" })).toMatchObject({ ok: false, error: "invalid_reason" });
    expect(await db.rpc(asUser(officer), "cancel_donation", { p_donation: res.id, p_reason: "Erreur de saisie" })).toMatchObject({ ok: true });
    expect(await capsulesOf(member)).toBe(0);
    expect(await db.rpc(asUser(officer), "cancel_donation", { p_donation: res.id, p_reason: "Encore" })).toMatchObject({ ok: false, error: "donation_closed" });
    expect((await db.sql("select * from public.admin_log where action = 'donation_cancelled' and target_id = $1", [member]))).toHaveLength(1);
  });
});

describe("le classement public des donneurs", () => {
  it("masque les anonymes par défaut, ne révèle ni nom ni numéro, et respecte le choix de chacun", async () => {
    const anonymous = await db.addMember("Discret");
    const named = await db.addMember("Fier");
    await db.rpc(asUser(named), "set_donation_anonymity", { p_anonymous: false });
    for (const [user, capsules] of [[anonymous, 90_000], [named, 80_000]] as const) {
      await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: capsules, p_donated_on: today() });
    }
    const ranking = await db.rpc<{ rows: { rank: number; name: string | null; total: number; recent: number; me: boolean }[]; read_at: string }>(ANON, "get_donor_ranking");
    const top = ranking.rows.slice(0, 2);
    expect(top[0]).toMatchObject({ rank: 1, name: null, total: 90_000, recent: 90_000, me: false });
    expect(top[1]).toMatchObject({ rank: 2, name: "Fier", total: 80_000 });
    expect(JSON.stringify(ranking)).not.toContain("Discret");
    expect(Date.parse(ranking.read_at)).toBeGreaterThan(0);

    const asThem = await db.rpc<{ rows: { me: boolean }[] }>(asUser(anonymous), "get_donor_ranking");
    expect(asThem.rows[0]!.me).toBe(true);

    await db.rpc(asUser(anonymous), "set_donation_anonymity", { p_anonymous: false });
    const after = await db.rpc<{ rows: { name: string | null }[] }>(ANON, "get_donor_ranking");
    expect(after.rows[0]!.name).toBe("Discret");
  });

  it("deux donneurs à égalité partagent la même place", async () => {
    const a = await db.addMember("EgalA");
    const b = await db.addMember("EgalB");
    for (const user of [a, b]) await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: 500_000, p_donated_on: today() });
    const ranking = await db.rpc<{ rows: { rank: number; total: number }[] }>(ANON, "get_donor_ranking");
    const equal = ranking.rows.filter((r) => r.total === 500_000);
    expect(equal.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("le total de départ ne compte ni dans la saison ni dans les 30 derniers jours", async () => {
    const member = await db.addMember("Ancien");
    await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: member, p_capsules: 700_000, p_donated_on: today(), p_kind: "opening" });
    const ranking = await db.rpc<{ rows: { total: number; recent: number }[] }>(ANON, "get_donor_ranking");
    expect(ranking.rows.find((r) => r.total === 700_000)).toMatchObject({ recent: 0 });
  });

  it("un membre suspendu sort du classement, et un don en attente n'y entre pas", async () => {
    const admin = await db.addMember("AdminDons", "admin");
    const member = await db.addMember("Suspendu");
    await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: member, p_capsules: 600_000, p_donated_on: today() });
    await declare(member, 12345);
    const totals = async () => (await db.rpc<{ rows: { total: number }[] }>(ANON, "get_donor_ranking")).rows.map((r) => r.total);
    expect(await totals()).toContain(600_000);
    expect(await totals()).not.toContain(612_345);
    await db.rpc(asUser(admin), "suspend_member", { p_user: member, p_reason: "Parti" });
    expect(await totals()).not.toContain(600_000);
  });
});

describe("les règles d'accès aux dons", () => {
  it("un membre ne lit que ses dons, et personne n'écrit directement", async () => {
    const a = await db.addMember("LecteurDonA");
    const b = await db.addMember("LecteurDonB");
    await declare(a, 11);
    await declare(b, 22);
    const seen = await withRole(db.pool, asUser(a), (c) => c.query("select capsules from public.donations"));
    expect(seen.rows.map((r) => Number(r.capsules))).toEqual([11]);
    for (const sql of [
      `update public.donations set status = 'approved' where user_id = '${a}'`,
      `update public.donations set capsules = 999999 where user_id = '${b}'`,
      `insert into public.donations (user_id, capsules, donated_on, created_by, status) values ('${a}', 999, current_date, '${a}', 'approved')`,
      `delete from public.donations where user_id = '${b}'`,
    ]) {
      await expect(withRole(db.pool, asUser(a), (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    await expect(withRole(db.pool, ANON, (c) => c.query("select * from public.donations"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("effacer son compte", () => {
  it("retire ses données et sa place au classement, et garde un journal sans nom", async () => {
    const member = await db.addMember("SurLeDepart");
    await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: member, p_capsules: 800_000, p_donated_on: today() });
    expect(await db.rpc(asUser(member), "delete_my_account")).toMatchObject({ ok: true });
    expect(await db.sql("select 1 from public.profiles where user_id = $1", [member])).toHaveLength(0);
    expect(await db.sql("select 1 from public.donations where user_id = $1", [member])).toHaveLength(0);
    expect(await db.sql("select 1 from auth.users where id = $1", [member])).toHaveLength(0);
    expect((await db.rpc<{ rows: { total: number }[] }>(ANON, "get_donor_ranking")).rows.map((r) => r.total)).not.toContain(800_000);
    expect(await db.sql("select 1 from public.admin_log where action = 'account_deleted' and target_id = $1", [member])).toHaveLength(1);
  });

  it("le fondateur doit d'abord transmettre son rôle", async () => {
    const founder = await db.addMember("FondateurDons", "founder");
    expect(await db.rpc(asUser(founder), "delete_my_account")).toMatchObject({ ok: false, error: "founder_cannot_leave" });
  });
});
