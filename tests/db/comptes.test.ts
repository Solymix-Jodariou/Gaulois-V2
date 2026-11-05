import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ANON, SERVICE, TestDb, asUser, callRpc, withRole } from "../support/database";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

const logOf = (action: string) => db.sql("select * from public.admin_log where action = $1 order by id", [action]);

describe("la première connexion", () => {
  it("crée un compte en attente, sans aucun droit, sous un nom neutre", async () => {
    const id = await db.addUser("PseudoDiscord");
    const me = await db.rpc(asUser(id), "get_me");
    expect(me).toMatchObject({ ok: true, signed_in: true, status: "pending", role: "member", rank: 0, anonymous: true, capsules: 0, discord_name: "PseudoDiscord", linked: false });
    expect(me.name).toMatch(/^Gaulois n° \d+$/);
  });

  it("garde le dernier pseudo Discord connu", async () => {
    const id = await db.addUser("Ancien");
    await db.sql("update auth.users set raw_user_meta_data = $2 where id = $1", [id, JSON.stringify({ full_name: "Nouveau" })]);
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ discord_name: "Nouveau" });
  });
});

describe("le fondateur", () => {
  it("se désigne une seule fois, et jamais depuis le navigateur", async () => {
    const id = await db.addUser("Chef");
    const [link] = await db.sql<{ discord_id: string }>("select discord_id from public.private_links where user_id = $1", [id]);

    await expect(db.rpc(asUser(id), "bootstrap_founder", { p_discord_id: link!.discord_id })).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "bootstrap_founder", { p_discord_id: link!.discord_id })).rejects.toMatchObject({ code: "42501" });

    expect(await db.rpc(SERVICE, "bootstrap_founder", { p_discord_id: "inconnu" })).toMatchObject({ ok: false, error: "user_not_found" });
    expect(await db.rpc(SERVICE, "bootstrap_founder", { p_discord_id: link!.discord_id })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ role: "founder", status: "validated", rank: 4 });

    const other = await db.addUser("Autre");
    const [otherLink] = await db.sql<{ discord_id: string }>("select discord_id from public.private_links where user_id = $1", [other]);
    expect(await db.rpc(SERVICE, "bootstrap_founder", { p_discord_id: otherLink!.discord_id })).toMatchObject({ ok: false, error: "founder_exists" });
    expect(await logOf("founder_bootstrap")).toHaveLength(1);
  });
});

describe("les rôles, vérifiés côté serveur", () => {
  it("un membre et un officier ne peuvent nommer personne", async () => {
    const member = await db.addMember("M1");
    const officer = await db.addMember("O1", "officer");
    const target = await db.addMember("Cible1");
    for (const who of [member, officer]) {
      expect(await db.rpc(asUser(who), "set_member_role", { p_user: target, p_role: "officer" })).toMatchObject({ ok: false, error: "forbidden" });
    }
    const [row] = await db.sql<{ role: string }>("select role from public.profiles where user_id = $1", [target]);
    expect(row!.role).toBe("member");
  });

  it("un admin gère les officiers, mais ne nomme ni ne retire d'admin", async () => {
    const admin = await db.addMember("A2", "admin");
    const otherAdmin = await db.addMember("A3", "admin");
    const target = await db.addMember("Cible2");
    expect(await db.rpc(asUser(admin), "set_member_role", { p_user: target, p_role: "officer" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(admin), "set_member_role", { p_user: target, p_role: "member" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(admin), "set_member_role", { p_user: target, p_role: "admin" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(admin), "set_member_role", { p_user: otherAdmin, p_role: "member" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(admin), "set_member_role", { p_user: admin, p_role: "member" })).toMatchObject({ ok: false, error: "not_on_yourself" });
  });

  it("le fondateur nomme et retire les admins, sans créer d'autre fondateur", async () => {
    const founder = await db.addMember("F2", "founder");
    const target = await db.addMember("Cible3");
    expect(await db.rpc(asUser(founder), "set_member_role", { p_user: target, p_role: "admin" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(founder), "set_member_role", { p_user: target, p_role: "member" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(founder), "set_member_role", { p_user: target, p_role: "founder" })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("un compte non validé n'a aucun droit, quel que soit son rôle écrit en base", async () => {
    const pending = await db.addUser("Attente");
    await db.sql("update public.profiles set role = 'admin' where user_id = $1", [pending]);
    const target = await db.addMember("Cible4");
    expect(await db.rpc(asUser(pending), "set_member_role", { p_user: target, p_role: "officer" })).toMatchObject({ ok: false, error: "not_validated" });
    expect(await db.rpc(asUser(pending), "list_members")).toMatchObject({ ok: false, error: "not_validated" });
  });

  it("toute action d'administration est journalisée : qui, quoi, quand", async () => {
    const founder = await db.addMember("F3", "founder");
    const target = await db.addMember("Cible5");
    await db.rpc(asUser(founder), "set_member_role", { p_user: target, p_role: "officer" });
    const rows = await db.sql<{ actor_id: string; target_id: string; details: { from: string; to: string }; at: Date }>(
      "select actor_id, target_id, details, at from public.admin_log where action = 'role_changed' and target_id = $1",
      [target],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: founder, target_id: target, details: { from: "member", to: "officer" } });
    expect(rows[0]!.at).toBeInstanceOf(Date);
  });

  it("le journal ne se modifie ni ne s'efface, et seuls les admins le lisent", async () => {
    const founder = await db.addMember("F4", "founder");
    const member = await db.addMember("M4");
    const officer = await db.addMember("O4", "officer");
    await db.rpc(asUser(founder), "set_member_role", { p_user: member, p_role: "officer" });
    await expect(db.sql("delete from public.admin_log")).rejects.toThrow(/journal/);
    await expect(db.sql("update public.admin_log set action = 'x'")).rejects.toThrow(/journal/);

    expect(await db.rpc(asUser(officer), "list_admin_log")).toMatchObject({ ok: false, error: "forbidden" });
    const read = await db.rpc<{ ok: boolean; rows: { action: string; actor: string }[] }>(asUser(founder), "list_admin_log");
    expect(read.ok).toBe(true);
    expect(read.rows.some((r) => r.action === "role_changed" && r.actor === "F4")).toBe(true);
  });
});

describe("la suspension", () => {
  it("coupe tous les droits, et se lève", async () => {
    const admin = await db.addMember("A5", "admin");
    const target = await db.addMember("Cible6", "officer");
    expect(await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "" })).toMatchObject({ ok: false, error: "invalid_reason" });
    expect(await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "A quitté le clan" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(target), "list_members")).toMatchObject({ ok: false, error: "suspended" });
    expect(await db.rpc(asUser(target), "get_me")).toMatchObject({ status: "suspended", status_reason: "A quitté le clan", rank: 0 });
    expect(await db.rpc(asUser(admin), "reinstate_member", { p_user: target })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(target), "get_me")).toMatchObject({ status: "validated", rank: 2 });
  });

  it("un admin ne suspend ni un autre admin ni le fondateur", async () => {
    const admin = await db.addMember("A6", "admin");
    const other = await db.addMember("A7", "admin");
    const founder = await db.addMember("F7", "founder");
    expect(await db.rpc(asUser(admin), "suspend_member", { p_user: other, p_reason: "non" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(admin), "suspend_member", { p_user: founder, p_reason: "non" })).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("les règles d'accès à la base", () => {
  it("un visiteur n'accède à aucune table", async () => {
    for (const table of ["profiles", "private_links", "admin_log", "action_limits", "action_requests", "clan_roster", "membership_requests", "app_state"]) {
      await expect(withRole(db.pool, ANON, (c) => c.query(`select * from public.${table}`)), table).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("un membre ne lit que sa propre ligne, et ne modifie rien, même chez lui", async () => {
    const a = await db.addMember("LecteurA");
    const b = await db.addMember("LecteurB");
    const seen = await withRole(db.pool, asUser(a), (c) => c.query("select user_id from public.profiles"));
    expect(seen.rows.map((r) => r.user_id)).toEqual([a]);
    const links = await withRole(db.pool, asUser(a), (c) => c.query("select user_id from public.private_links"));
    expect(links.rows.map((r) => r.user_id)).toEqual([a]);

    for (const sql of [
      `update public.profiles set role = 'founder' where user_id = '${a}'`,
      `update public.profiles set capsules_total = 999 where user_id = '${b}'`,
      `delete from public.profiles where user_id = '${b}'`,
      `insert into public.admin_log (action) values ('faux')`,
      `update public.private_links set discord_name = 'x' where user_id = '${a}'`,
    ]) {
      await expect(withRole(db.pool, asUser(a), (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("un officier lit les profils, sans pouvoir les écrire", async () => {
    const officer = await db.addMember("LecteurO", "officer");
    const member = await db.addMember("LecteurM");
    const seen = await withRole(db.pool, asUser(officer), (c) => c.query("select user_id from public.profiles where user_id = $1", [member]));
    expect(seen.rows).toHaveLength(1);
    await expect(withRole(db.pool, asUser(officer), (c) => c.query(`update public.profiles set role = 'admin' where user_id = '${member}'`))).rejects.toMatchObject({ code: "42501" });
  });

  it("aucune fonction interne n'est appelable depuis l'extérieur", async () => {
    const member = await db.addMember("Curieux");
    for (const sql of ["select internal.fail('x')", "select internal.log_admin(null, 'x', null)", "select internal.require_rank(1)"]) {
      await expect(withRole(db.pool, asUser(member), (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    await expect(withRole(db.pool, ANON, (c) => c.query("select internal.current_rank()"))).rejects.toMatchObject({ code: "42501" });
  });

  it("chaque fonction publique a été rendue explicitement : rien n'est ouvert par défaut", async () => {
    const open = await db.sql<{ name: string; role: string }>(`
      select p.proname as name, r.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join pg_roles r
      where n.nspname = 'public' and r.rolname = 'anon' and has_function_privilege('anon', p.oid, 'execute')
      order by 1`);
    const allowed = new Set(["get_game_state", "get_game_pulse", "get_feed", "get_donor_ranking", "get_season_history", "get_closed_season"]);
    expect(open.map((o) => o.name).filter((name) => !allowed.has(name))).toEqual([]);
  });
});

describe("la limite de requêtes", () => {
  it("bloque au-delà du plafond, même si les actions sont refusées, et repart à la minute suivante", async () => {
    const member = await db.addMember("Bavard");
    const target = await db.addMember("CibleBavard");
    let lastError = "";
    for (let i = 0; i < 31; i++) {
      const res = await db.rpc(asUser(member), "set_member_role", { p_user: target, p_role: "officer" });
      lastError = String(res.error);
      if (i < 30) expect(res.error).toBe("forbidden");
    }
    expect(lastError).toBe("rate_limited");
    await db.sql("update public.action_limits set minute = minute - interval '2 minutes' where user_id = $1", [member]);
    expect(await db.rpc(asUser(member), "set_member_role", { p_user: target, p_role: "officer" })).toMatchObject({ error: "forbidden" });
  });
});

describe("l'outil de test lui-même", () => {
  it("les fonctions refusent de s'exécuter sans le bon rôle, comme l'API de Supabase", async () => {
    await expect(callRpc(db.pool, ANON, "get_me")).rejects.toMatchObject({ code: "42501" });
    await expect(callRpc(db.pool, ANON, "nom; drop table x")).rejects.toThrow(/refusé/);
  });
});
