/**
 * Pour les tests seulement : un petit serveur qui parle comme Supabase, branché sur un vrai Postgres.
 * Les rôles, les règles d'accès et les fonctions sont donc les vrais. Seules changent la connexion
 * Discord, remplacée par une page de choix, et la conservation des fichiers, gardés en mémoire.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type pg from "pg";
import { type Who, callRpc, withRole } from "./database";

export const FAKE_SECRET = "secret-de-test-seulement";
export const FAKE_SERVICE_KEY = "sb_secret_cle-de-test";

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signJwt(claims: Record<string, unknown>): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${createHmac("sha256", FAKE_SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

function readJwt(token: string): Record<string, unknown> | null {
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  if (createHmac("sha256", FAKE_SECRET).update(`${head}.${body}`).digest("base64url") !== signature) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  return typeof claims["exp"] === "number" && claims["exp"] * 1000 > Date.now() ? claims : null;
}

interface PendingCode {
  userId: string;
  challenge: string;
}

export function startFakeSupabase(pool: pg.Pool, port: number, options: { accounts?: readonly string[] } = {}): Promise<Server> {
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Map<string, string>();
  const files = new Map<string, { type: string; body: Buffer }>();

  const userOf = async (id: string) => {
    const rows = await pool.query<{ id: string; email: string | null; raw_user_meta_data: Record<string, unknown>; created_at: Date }>("select * from auth.users where id = $1", [id]);
    const u = rows.rows[0];
    if (!u) return null;
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      app_metadata: { provider: "discord", providers: ["discord"] },
      user_metadata: u.raw_user_meta_data,
      created_at: u.created_at,
      updated_at: u.created_at,
    };
  };

  const sessionFor = async (id: string) => {
    const now = Math.floor(Date.now() / 1000);
    const refresh = randomUUID();
    refreshTokens.set(refresh, id);
    return {
      access_token: signJwt({ sub: id, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 }),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refresh,
      user: await userOf(id),
    };
  };

  const whoFrom = (req: IncomingMessage): Who => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
    if (token === FAKE_SERVICE_KEY || req.headers["apikey"] === FAKE_SERVICE_KEY) return { kind: "service" };
    const claims = readJwt(token);
    return claims && typeof claims["sub"] === "string" ? { kind: "user", id: claims["sub"] } : { kind: "anon" };
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  /** Extrait le fichier d'un envoi multipart, comme le fait la bibliothèque de Supabase. */
  const fileFrom = (req: IncomingMessage, body: Buffer): { type: string; body: Buffer } => {
    const contentType = req.headers["content-type"] ?? "";
    const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
    if (!boundary) return { type: contentType, body };
    const text = body.toString("latin1");
    for (const part of text.split(`--${boundary}`)) {
      const match = /Content-Disposition:[^\r\n]*name="[^"]*"; filename="[^"]*"\r\nContent-Type: ([^\r\n]+)\r\n\r\n/i.exec(part);
      if (match) return { type: match[1]!, body: Buffer.from(part.slice(match.index + match[0].length, -2), "latin1") };
    }
    return { type: "application/octet-stream", body };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,x-upsert,cache-control,x-supabase-api-version");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    /* ---------- L'API ---------- */
    const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(path);
    if (rpc && req.method === "POST") {
      const text = (await readBody(req)).toString();
      try {
        json(res, 200, await callRpc(pool, whoFrom(req), rpc[1]!, text ? (JSON.parse(text) as Record<string, unknown>) : {}));
      } catch (e) {
        const error = e as { code?: string; message?: string; detail?: string; hint?: string };
        json(res, error.code === "42501" ? 401 : 400, { code: error.code ?? "PGRST000", message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
      }
      return;
    }

    /* ---------- La connexion : une page de choix à la place de Discord ---------- */
    if (path === "/auth/v1/authorize") {
      const params = new URLSearchParams({ redirect_to: url.searchParams.get("redirect_to") ?? "", code_challenge: url.searchParams.get("code_challenge") ?? "" });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      const accounts = (options.accounts ?? [])
        .map((name) => `<form action="/auth/v1/test-login?${params}" method="post"><input type="hidden" name="name" value="${name}"><button>Se connecter comme ${name}</button></form>`)
        .join("");
      res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Connexion de test</title>
        <style>body{font:16px system-ui;background:#0a1230;color:#fff;max-width:32rem;margin:3rem auto;padding:0 1rem}button{font:inherit;margin:.25rem 0;padding:.625rem 1rem;border-radius:.5rem;border:0;background:#0b5fff;color:#fff;cursor:pointer}input{font:inherit;padding:.5rem}</style>
        <h1>Connexion de test</h1><p>Cette page remplace Discord sur votre PC. Rien n'est réel, rien ne part en ligne.</p>${accounts}
        <form action="/auth/v1/test-login?${params}" method="post"><label>Nom Discord <input name="name" required></label> <button>Se connecter</button></form>`);
      return;
    }
    if (path === "/auth/v1/test-login" && req.method === "POST") {
      const name = new URLSearchParams((await readBody(req)).toString()).get("name") ?? "Anonyme";
      const providerId = `discord-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
      const existing = await pool.query<{ id: string }>("select id from auth.users where raw_user_meta_data ->> 'provider_id' = $1", [providerId]);
      const id =
        existing.rows[0]?.id ??
        (await pool.query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`${providerId}@example.test`, JSON.stringify({ provider_id: providerId, full_name: name })])).rows[0]!.id;
      const code = randomUUID();
      codes.set(code, { userId: id, challenge: url.searchParams.get("code_challenge") ?? "" });
      const target = new URL(url.searchParams.get("redirect_to") ?? "/");
      target.searchParams.set("code", code);
      res.writeHead(303, { Location: target.href });
      res.end();
      return;
    }
    if (path === "/auth/v1/token" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { auth_code?: string; code_verifier?: string; refresh_token?: string };
      const grant = url.searchParams.get("grant_type");
      if (grant === "pkce") {
        const pending = codes.get(body.auth_code ?? "");
        const hashed = createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
        if (!pending || (pending.challenge && pending.challenge !== hashed)) {
          json(res, 400, { error: "invalid_grant", error_description: "Code refusé" });
          return;
        }
        codes.delete(body.auth_code ?? "");
        json(res, 200, await sessionFor(pending.userId));
        return;
      }
      if (grant === "refresh_token") {
        const id = refreshTokens.get(body.refresh_token ?? "");
        if (!id) {
          json(res, 400, { error: "invalid_grant", error_description: "Jeton refusé" });
          return;
        }
        json(res, 200, await sessionFor(id));
        return;
      }
      json(res, 400, { error: "unsupported_grant_type" });
      return;
    }
    if (path === "/auth/v1/user") {
      const who = whoFrom(req);
      if (who.kind !== "user") json(res, 401, { message: "Non connecté" });
      else json(res, 200, await userOf(who.id));
      return;
    }
    if (path === "/auth/v1/logout") {
      res.writeHead(204);
      res.end();
      return;
    }

    /* ---------- Les fichiers : les règles d'accès de la base décident, le contenu reste en mémoire ---------- */
    const sign = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(path);
    if (sign && req.method === "POST") {
      const name = decodeURIComponent(sign[2]!);
      const seen = await withRole(pool, whoFrom(req), (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [sign[1], name])).catch(() => ({ rowCount: 0 }));
      if (!seen.rowCount) {
        json(res, 400, { statusCode: "404", error: "not_found", message: "Fichier introuvable" });
        return;
      }
      json(res, 200, { signedURL: `/object/sign/${sign[1]}/${sign[2]}?token=test` });
      return;
    }
    if (sign && req.method === "GET") {
      const file = files.get(`${sign[1]}/${decodeURIComponent(sign[2]!)}`);
      if (!file) {
        json(res, 404, { message: "Fichier introuvable" });
        return;
      }
      res.writeHead(200, { "Content-Type": file.type });
      res.end(file.body);
      return;
    }
    const object = /^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (object && req.method === "POST" && object[2]) {
      const name = decodeURIComponent(object[2]);
      const body = await readBody(req);
      try {
        const who = whoFrom(req);
        await withRole(pool, who, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [object[1], name, who.kind === "user" ? who.id : null]));
        files.set(`${object[1]}/${name}`, fileFrom(req, body));
        json(res, 200, { Key: `${object[1]}/${name}`, Id: randomUUID() });
      } catch {
        json(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      }
      return;
    }
    if (object && req.method === "DELETE") {
      const { prefixes } = JSON.parse((await readBody(req)).toString()) as { prefixes: string[] };
      const removed = await withRole(pool, whoFrom(req), (c) => c.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [object[1], prefixes]));
      for (const row of removed.rows) files.delete(`${object[1]}/${row.name}`);
      json(res, 200, removed.rows);
      return;
    }

    /* ---------- Pour préparer une situation de test ---------- */
    if (path === "/__test/sql" && req.method === "POST") {
      const { sql, params } = JSON.parse((await readBody(req)).toString()) as { sql: string; params?: unknown[] };
      json(res, 200, (await pool.query(sql, params)).rows);
      return;
    }
    if (path === "/__test/service" && req.method === "POST") {
      const { fn, args } = JSON.parse((await readBody(req)).toString()) as { fn: string; args?: Record<string, unknown> };
      json(res, 200, await callRpc(pool, { kind: "service" }, fn, args ?? {}));
      return;
    }
    if (path === "/__test/health") {
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { message: `Route inconnue : ${req.method} ${path}` });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => json(res, 500, { message: String(e) }));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
