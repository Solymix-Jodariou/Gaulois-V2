/**
 * Un vrai Postgres local pour les tests, sans Docker : les droits, les verrous et les
 * attaques simultanées y sont éprouvés pour de vrai, avec de vraies connexions.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const USER = "postgres";
const PASSWORD = "test";
export const TEMPLATE_DB = "gal_modele";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

export const connection = (port: number, database: string) => ({ host: "127.0.0.1", port, user: USER, password: PASSWORD, database });

export function migrationFiles(dir = "supabase/migrations"): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

/** Retire les bases laissées par un test interrompu : elles n'ont plus aucune utilité après un jour. */
function removeOldServers(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith("gal-pg-")) continue;
    const path = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(path).mtimeMs > 86_400_000) rmSync(path, { recursive: true, force: true });
    } catch {
      // Encore utilisée par un autre test : on la laisse.
    }
  }
}

/** Démarre le serveur et prépare une base modèle : les outils de Supabase, puis nos migrations. */
export async function startDatabaseServer(): Promise<{ port: number; stop(): Promise<void> }> {
  removeOldServers();
  const dir = mkdtempSync(join(tmpdir(), "gal-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: USER,
    password: PASSWORD,
    port,
    persistent: false,
    // UTF-8 comme chez Supabase, quelle que soit la langue du poste : sous Windows, la base serait sinon en WIN1252.
    initdbFlags: ["--encoding=UTF8", "--locale-provider=builtin", "--builtin-locale=C.UTF-8"],
    postgresFlags: ["-c", "max_connections=400", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const admin = new pg.Client(connection(port, "postgres"));
  await admin.connect();
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const model = new pg.Client(connection(port, TEMPLATE_DB));
  await model.connect();
  await model.query(readFileSync("tests/support/supabase-shim.sql", "utf8"));
  for (const file of migrationFiles()) {
    try {
      await model.query(readFileSync(file, "utf8"));
    } catch (e) {
      await model.end();
      await server.stop();
      throw new Error(`Migration refusée : ${file} : ${(e as Error).message}`);
    }
  }
  await model.end();

  return {
    port,
    stop: async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type Who = { kind: "anon" } | { kind: "service" } | { kind: "user"; id: string };
export const ANON: Who = { kind: "anon" };
export const SERVICE: Who = { kind: "service" };
export const asUser = (id: string): Who => ({ kind: "user", id });

const ROLES = { anon: "anon", service: "service_role", user: "authenticated" } as const;

/** Exécute une requête comme le ferait l'API de Supabase : sous le rôle de l'appelant, avec son identité. */
export async function withRole<T>(pool: pg.Pool, who: Who, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claims = who.kind === "user" ? { sub: who.id, role: "authenticated" } : { role: ROLES[who.kind] };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${ROLES[who.kind]}`);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Appelle une fonction exposée, avec ses arguments nommés, comme `supabase.rpc()`. */
export async function callRpc<T = unknown>(pool: pg.Pool, who: Who, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`Nom de fonction refusé : ${fn}`);
  const names = Object.keys(args);
  for (const name of names) if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Argument refusé : ${name}`);
  const values = names.map((name) => {
    const value = args[name];
    return typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  });
  const call = `select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(", ")}) as result`;
  return withRole(pool, who, async (client) => (await client.query(call, values)).rows[0].result as T);
}

/** Une base toute neuve, copiée du modèle, pour un fichier de tests. */
export class TestDb {
  private constructor(
    readonly pool: pg.Pool,
    private readonly admin: pg.Pool,
    private readonly name: string,
  ) {}

  static async create(port: number): Promise<TestDb> {
    const name = `t_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ ...connection(port, "postgres"), max: 1 });
    await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    const pool = new pg.Pool({ ...connection(port, name), max: 40 });
    return new TestDb(pool, admin, name);
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.admin.query(`drop database if exists ${this.name} with (force)`);
    await this.admin.end();
  }

  /** Une requête en superutilisateur, pour préparer une situation ou vérifier l'état réel. */
  async sql<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> {
    return (await this.pool.query<R>(text, params)).rows;
  }

  rpc<T = RpcResult>(who: Who, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return callRpc<T>(this.pool, who, fn, args);
  }

  /** Crée un compte comme le ferait une première connexion Discord. */
  async addUser(discordName: string): Promise<string> {
    const meta = { provider_id: `discord-${randomUUID().slice(0, 8)}`, full_name: discordName };
    const rows = await this.sql<{ id: string }>("insert into auth.users (raw_user_meta_data) values ($1) returning id", [JSON.stringify(meta)]);
    return rows[0]!.id;
  }

  /** Un compte déjà validé, avec le rôle demandé. */
  async addMember(name: string, role: "member" | "officer" | "admin" | "founder" = "member"): Promise<string> {
    const id = await this.addUser(name);
    await this.sql("update public.profiles set status = 'validated', role = $2, display_name = $3, validated_at = now() where user_id = $1", [id, role, name]);
    return id;
  }
}

export type RpcResult = { ok: boolean; error?: string; detail?: unknown } & Record<string, unknown>;
