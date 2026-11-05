import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ANON, SERVICE, TestDb, asUser, withRole } from "../support/database";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

const discordIdOf = async (id: string) => (await db.sql<{ discord_id: string | null }>("select discord_id from public.private_links where user_id = $1", [id]))[0]!.discord_id;

/** Un compte créé par e-mail, avec les métadonnées de son choix : l'attaquant les écrit lui-même. */
const emailSignup = async (meta: Record<string, unknown>) => {
  // Sans la clé provider_id, l'imitation de Supabase ne crée aucune identité : comme pour une vraie inscription par e-mail.
  const { provider_id: forged, ...rest } = meta;
  const written = { ...rest, sub: forged ?? rest["sub"] ?? null, forged_provider_id: forged ?? null };
  return (await db.sql<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ('x@example.test', $1) returning id", [JSON.stringify(written)]))[0]!.id;
};

describe("l'identité Discord ne vient que de Discord", () => {
  it("modifier ses métadonnées, comme auth.updateUser le permet, ne change pas le nom vu par les officiers", async () => {
    const id = await db.addUser("VraiNom");
    await db.sql("update auth.users set raw_user_meta_data = raw_user_meta_data || $2 where id = $1", [id, JSON.stringify({ full_name: "Flooo", name: "Flooo", provider_id: "usurpe" })]);
    await db.sql("update auth.users set last_sign_in_at = now() + interval '1 minute' where id = $1", [id]);
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ discord_name: "VraiNom" });
    expect(await discordIdOf(id)).not.toBe("usurpe");
  });

  it("un compte créé par e-mail n'a aucune identité Discord, même s'il en écrit une", async () => {
    const victim = await db.addUser("Victime");
    const victimId = await discordIdOf(victim);
    const forged = await emailSignup({ provider_id: victimId, sub: victimId, full_name: "Victime" });
    expect(await discordIdOf(forged)).toBeNull();
    expect(await db.rpc(asUser(forged), "get_me")).toMatchObject({ discord_name: null });
  });

  it("un faux compte ne peut pas être désigné fondateur à la place du vrai", async () => {
    const fresh = await TestDb.create(inject("pgPort"));
    try {
      await fresh.sql("insert into auth.users (email, raw_user_meta_data) values ('a@example.test', $1)", [JSON.stringify({ sub: "12345", full_name: "Chef" })]);
      expect(await fresh.rpc(SERVICE, "bootstrap_founder", { p_discord_id: "12345" })).toMatchObject({ ok: false, error: "user_not_found" });
      const [count] = await fresh.sql<{ n: number }>("select count(*)::int as n from public.profiles where role = 'founder'");
      expect(count!.n).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  it("un compte sans Discord ne peut pas demander sa validation", async () => {
    const id = await emailSignup({ full_name: "SansDiscord" });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Quelqu'un" })).toMatchObject({ ok: false, error: "discord_required" });
  });
});

describe("la suspension ne se contourne pas", () => {
  it("un officier ne peut pas lever une suspension en validant une demande restée ouverte", async () => {
    const officer = await db.addMember("OffSusp", "officer");
    const admin = await db.addMember("AdmSusp", "admin");
    const target = await db.addUser("Suspect");
    await db.rpc(asUser(target), "request_membership", { p_claim: "Suspect" });
    const [request] = await db.sql<{ id: number }>("select id from public.membership_requests where user_id = $1", [target]);
    expect(await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "Triche" })).toMatchObject({ ok: true });
    const res = await db.rpc(asUser(officer), "review_membership", { p_request: request!.id, p_approve: true });
    expect(res.ok).toBe(false);
    expect(await db.rpc(asUser(target), "get_me")).toMatchObject({ status: "suspended", rank: 0 });
  });

  it("un admin ne réintègre pas un autre admin suspendu par le fondateur", async () => {
    const founder = await db.addMember("FondSusp", "founder");
    const admin = await db.addMember("AdmA", "admin");
    const other = await db.addMember("AdmB", "admin");
    expect(await db.rpc(asUser(founder), "suspend_member", { p_user: other, p_reason: "Décision du fondateur" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(admin), "reinstate_member", { p_user: other })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(other), "get_me")).toMatchObject({ status: "suspended" });
    expect(await db.rpc(asUser(founder), "reinstate_member", { p_user: other })).toMatchObject({ ok: true });
  });

  it("réintégrer un compte jamais validé ne le valide pas", async () => {
    const admin = await db.addMember("AdmJamais", "admin");
    const target = await db.addUser("JamaisValide");
    await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "Doute" });
    expect(await db.rpc(asUser(admin), "reinstate_member", { p_user: target })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(target), "get_me")).toMatchObject({ status: "pending", rank: 0 });
  });

  it("une réintégration normale marche toujours", async () => {
    const admin = await db.addMember("AdmOk", "admin");
    const target = await db.addMember("MembreOk");
    await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "Pause" });
    expect(await db.rpc(asUser(admin), "reinstate_member", { p_user: target })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(target), "get_me")).toMatchObject({ status: "validated", rank: 1 });
  });
});

describe("la transmission du rôle de fondateur", () => {
  it("seul le fondateur transmet, à un membre validé, et devient admin", async () => {
    const founder = await db.addMember("FondTrans", "founder");
    const admin = await db.addMember("AdmTrans", "admin");
    const heir = await db.addMember("Heritier");
    const pending = await db.addUser("EnAttente");

    expect(await db.rpc(asUser(admin), "transfer_founder", { p_user: heir })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(heir), "transfer_founder", { p_user: heir })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(founder), "transfer_founder", { p_user: founder })).toMatchObject({ ok: false, error: "not_on_yourself" });
    expect(await db.rpc(asUser(founder), "transfer_founder", { p_user: pending })).toMatchObject({ ok: false, error: "target_not_validated" });
    expect(await db.rpc(ANON, "get_site_news")).toMatchObject({ ok: true });

    expect(await db.rpc(asUser(founder), "transfer_founder", { p_user: heir })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(heir), "get_me")).toMatchObject({ role: "founder", rank: 4 });
    expect(await db.rpc(asUser(founder), "get_me")).toMatchObject({ role: "admin", rank: 3 });
    expect(await db.sql("select 1 from public.admin_log where action = 'founder_transferred' and target_id = $1", [heir])).toHaveLength(1);
    // L'ancien fondateur peut maintenant partir.
    expect(await db.rpc(asUser(founder), "delete_my_account")).toMatchObject({ ok: true });
  });
});

describe("les annonces", () => {
  const news = () => db.rpc<{ ok: boolean; announcements: { id: number; title: string; body: string; url: string | null }[]; events: { id: number; title: string }[] }>(ANON, "get_site_news");

  it("un officier publie, tout le monde lit, même sans compte", async () => {
    const officer = await db.addMember("Annonceur", "officer");
    const res = await db.rpc<{ ok: boolean; id: number }>(asUser(officer), "save_announcement", { p_id: null, p_title: "Soirée vocale", p_body: "Vendredi soir sur le Discord.", p_url: "https://discord.gg/exemple" });
    expect(res.ok).toBe(true);
    const seen = (await news()).announcements.find((a) => a.id === res.id);
    expect(seen).toMatchObject({ title: "Soirée vocale", body: "Vendredi soir sur le Discord.", url: "https://discord.gg/exemple" });
    expect(seen).not.toHaveProperty("author");
    expect(await db.sql("select 1 from public.admin_log where action = 'announcement_saved' and actor_id = $1", [officer])).toHaveLength(1);
  });

  it("un visiteur, un compte en attente et un membre ne publient rien", async () => {
    const member = await db.addMember("SimpleMembre");
    const pending = await db.addUser("Attente2");
    const args = { p_id: null, p_title: "Faux", p_body: "Faux", p_url: null };
    await expect(db.rpc(ANON, "save_announcement", args)).rejects.toMatchObject({ code: "42501" });
    expect(await db.rpc(asUser(pending), "save_announcement", args)).toMatchObject({ ok: false, error: "not_validated" });
    expect(await db.rpc(asUser(member), "save_announcement", args)).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("refuse un lien dangereux : il finirait dans le href de la page d'accueil", async () => {
    const officer = await db.addMember("AnnonceurLien", "officer");
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "http://exemple.fr", "https://a b", 'https://a"onclick="x', `https://${"a".repeat(600)}`]) {
      expect(await db.rpc(asUser(officer), "save_announcement", { p_id: null, p_title: "T", p_body: "B", p_url: url }), url).toMatchObject({ ok: false, error: "invalid_url" });
    }
  });

  it("refuse un texte vide ou trop long", async () => {
    const officer = await db.addMember("AnnonceurTexte", "officer");
    expect(await db.rpc(asUser(officer), "save_announcement", { p_id: null, p_title: "  ", p_body: "B", p_url: null })).toMatchObject({ ok: false, error: "invalid_title" });
    expect(await db.rpc(asUser(officer), "save_announcement", { p_id: null, p_title: "x".repeat(121), p_body: "B", p_url: null })).toMatchObject({ ok: false, error: "invalid_title" });
    expect(await db.rpc(asUser(officer), "save_announcement", { p_id: null, p_title: "T", p_body: " ", p_url: null })).toMatchObject({ ok: false, error: "invalid_body" });
    expect(await db.rpc(asUser(officer), "save_announcement", { p_id: null, p_title: "T", p_body: "x".repeat(2001), p_url: null })).toMatchObject({ ok: false, error: "invalid_body" });
  });

  it("un officier ne touche qu'à ses annonces, un admin à toutes", async () => {
    const author = await db.addMember("Auteur", "officer");
    const other = await db.addMember("AutreOfficier", "officer");
    const admin = await db.addMember("AdmAnnonce", "admin");
    const { id } = await db.rpc<{ id: number }>(asUser(author), "save_announcement", { p_id: null, p_title: "Ma note", p_body: "Texte", p_url: null });
    const edit = { p_id: id, p_title: "Modifiée", p_body: "Texte", p_url: null };
    expect(await db.rpc(asUser(other), "save_announcement", edit)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(other), "delete_announcement", { p_id: id })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(author), "save_announcement", edit)).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(admin), "delete_announcement", { p_id: id })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(admin), "delete_announcement", { p_id: id })).toMatchObject({ ok: false, error: "news_not_found" });
    expect((await news()).announcements.some((a) => a.id === id)).toBe(false);
    // Le titre reste au journal après la suppression.
    expect(await db.sql("select 1 from public.admin_log where action = 'announcement_deleted' and details ->> 'title' = 'Modifiée'")).toHaveLength(1);
  });

  it("une annonce survit au départ de son auteur", async () => {
    const author = await db.addMember("Partant", "officer");
    const { id } = await db.rpc<{ id: number }>(asUser(author), "save_announcement", { p_id: null, p_title: "Reste", p_body: "Texte", p_url: null });
    expect(await db.rpc(asUser(author), "delete_my_account")).toMatchObject({ ok: true });
    expect((await news()).announcements.some((a) => a.id === id)).toBe(true);
  });

  it("personne n'accède aux tables directement", async () => {
    const officer = await db.addMember("Curieux2", "officer");
    for (const table of ["site_announcements", "site_events"]) {
      await expect(withRole(db.pool, ANON, (c) => c.query(`select * from public.${table}`)), table).rejects.toMatchObject({ code: "42501" });
      await expect(withRole(db.pool, asUser(officer), (c) => c.query(`insert into public.${table} (title) values ('x')`)), table).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("les événements", () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  it("un officier en crée, seuls ceux à venir sont publics, dans l'ordre", async () => {
    const officer = await db.addMember("Organisateur", "officer");
    const late = await db.rpc<{ id: number }>(asUser(officer), "save_event", { p_id: null, p_title: "Plus tard", p_description: null, p_url: null, p_starts_at: inDays(5) });
    const soon = await db.rpc<{ id: number }>(asUser(officer), "save_event", { p_id: null, p_title: "Bientôt", p_description: "Tous en vocal", p_url: null, p_starts_at: inDays(1) });
    await db.sql("insert into public.site_events (title, starts_at) values ('Passé', now() - interval '1 day')");
    const { events } = await db.rpc<{ events: { id: number; title: string }[] }>(ANON, "get_site_news");
    expect(events.map((e) => e.title)).not.toContain("Passé");
    expect(events.findIndex((e) => e.id === soon.id)).toBeLessThan(events.findIndex((e) => e.id === late.id));
  });

  it("refuse une date passée ou absente, et les membres", async () => {
    const officer = await db.addMember("Organisateur2", "officer");
    const member = await db.addMember("Spectateur");
    const base = { p_id: null, p_title: "E", p_description: null, p_url: null };
    expect(await db.rpc(asUser(officer), "save_event", { ...base, p_starts_at: inDays(-1) })).toMatchObject({ ok: false, error: "invalid_start" });
    expect(await db.rpc(asUser(officer), "save_event", { ...base, p_starts_at: null })).toMatchObject({ ok: false, error: "invalid_start" });
    expect(await db.rpc(asUser(member), "save_event", { ...base, p_starts_at: inDays(1) })).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("le tableau de bord de la direction", () => {
  it("est réservé aux officiers et compte ce qui attend une décision", async () => {
    const officer = await db.addMember("Tableau", "officer");
    const member = await db.addMember("PasTableau");
    const pending = await db.addUser("EnFile");
    await db.rpc(asUser(pending), "request_membership", { p_claim: "EnFile" });
    expect(await db.rpc(asUser(member), "get_direction_overview")).toMatchObject({ ok: false, error: "forbidden" });
    await expect(db.rpc(ANON, "get_direction_overview")).rejects.toMatchObject({ code: "42501" });
    const overview = await db.rpc<{ ok: boolean; pending_requests: number; pending_donations: number; members: number; officers: number; suspended: number; announcements: unknown[]; events: unknown[] }>(asUser(officer), "get_direction_overview");
    expect(overview.ok).toBe(true);
    expect(overview.pending_requests).toBeGreaterThanOrEqual(1);
    expect(overview.officers).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(overview.announcements)).toBe(true);
    expect(Array.isArray(overview.events)).toBe(true);
  });

  it("indique à l'officier le rang en jeu de celui qui demande, sans le lui donner", async () => {
    const officer = await db.addMember("Verif", "officer");
    const chief = await db.addUser("ChefEnJeu");
    await db.sql("insert into public.clan_roster (public_id_hash, username, game_role) values ('hash-chef', 'ChefOF', 'leader')");
    await db.rpc(asUser(chief), "request_membership", { p_claim: "ChefOF" });
    const { rows } = await db.rpc<{ rows: { roster_username: string; game_role: string }[] }>(asUser(officer), "list_membership_requests");
    expect(rows.find((r) => r.roster_username === "ChefOF")?.game_role).toBe("leader");
    const [request] = await db.sql<{ id: number }>("select id from public.membership_requests where user_id = $1", [chief]);
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: request!.id, p_approve: true })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(chief), "get_me")).toMatchObject({ role: "member", rank: 1 });
  });
});

describe("la sauvegarde", () => {
  it("contient les annonces et les événements", async () => {
    const backup = await db.rpc<Record<string, unknown>>(SERVICE, "export_all");
    expect(backup).toHaveProperty("site_announcements");
    expect(backup).toHaveProperty("site_events");
    expect(backup).toHaveProperty("profiles");
  });
});
