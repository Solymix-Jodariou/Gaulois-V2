/**
 * Vérifie un vrai projet Supabase de l'extérieur, comme le ferait un visiteur :
 * la connexion Discord est-elle active, le schéma est-il installé, les portes sont-elles fermées ?
 * Lancé par scripts/verifier-mise-en-ligne.ts. N'écrit rien et n'affiche jamais une clé.
 */
export interface PreflightOptions {
  url: string;
  publishableKey: string;
  secretKey?: string | undefined;
  fetcher?: typeof fetch;
}

export interface Check {
  label: string;
  /** `warn` : à regarder, sans empêcher la mise en ligne. */
  status: "ok" | "fail" | "warn";
  detail?: string;
}

/** Une route fermée à un visiteur peut répondre 401, 403 ou 404 selon la version de Supabase. */
const isClosed = (status: number) => status >= 400 && status < 500;

export async function runPreflight({ url, publishableKey, secretKey, fetcher = fetch }: PreflightOptions): Promise<Check[]> {
  const base = url.replace(/\/$/, "");
  const checks: Check[] = [];
  const add = (label: string, status: Check["status"], detail?: string) => checks.push(detail === undefined ? { label, status } : { label, status, detail });

  if (publishableKey.startsWith("sb_secret_")) {
    add("La clé publique n'est pas une clé secrète", "fail", "SUPABASE_PUBLISHABLE_KEY contient une clé secrète. Elle partirait dans le navigateur de chaque visiteur : remplacez-la, et régénérez cette clé dans Supabase.");
    return checks;
  }

  const anonHeaders = { apikey: publishableKey, "Content-Type": "application/json" };
  const rpc = (fn: string, body: Record<string, unknown> = {}) => fetcher(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: anonHeaders, body: JSON.stringify(body) });

  let settings: { external?: Record<string, boolean> };
  try {
    const res = await fetcher(`${base}/auth/v1/settings`, { headers: { apikey: publishableKey } });
    if (!res.ok) {
      add("Le projet répond", "fail", `Réponse ${res.status}. Vérifiez SUPABASE_URL et la clé publique.`);
      return checks;
    }
    settings = (await res.json()) as typeof settings;
    add("Le projet répond", "ok");
  } catch {
    add("Le projet répond", "fail", "Aucune réponse. Vérifiez SUPABASE_URL. Un projet gratuit se met aussi en pause après une semaine sans activité.");
    return checks;
  }

  if (settings.external?.["discord"]) add("La connexion Discord est activée", "ok");
  else add("La connexion Discord est activée", "fail", "Authentication → Providers → Discord : activez-la, avec le Client ID et le Client Secret.");

  if (settings.external?.["email"]) add("L'inscription par e-mail est coupée", "warn", "Authentication → Providers → Email : désactivez-la. Le site ne s'en sert pas : ces comptes ne peuvent rien demander, mais ils encombrent la base.");
  else add("L'inscription par e-mail est coupée", "ok");

  const news = await rpc("get_site_news");
  if (news.ok) add("Le schéma est installé", "ok");
  else add("Le schéma est installé", "fail", `get_site_news répond ${news.status}. Installez les migrations de supabase/migrations, dans l'ordre.`);

  const bootstrap = await rpc("bootstrap_founder", { p_discord_id: "verification" });
  if (isClosed(bootstrap.status)) add("Un visiteur ne peut pas se désigner fondateur", "ok");
  else add("Un visiteur ne peut pas se désigner fondateur", "fail", `Réponse ${bootstrap.status}. Le fichier …_droits.sql n'a sans doute pas été installé : ne mettez pas en ligne.`);

  for (const table of ["profiles", "private_links", "admin_log", "clan_roster", "site_announcements"]) {
    const res = await fetcher(`${base}/rest/v1/${table}?select=*&limit=1`, { headers: anonHeaders });
    const rows = res.ok ? ((await res.json()) as unknown[]) : [];
    if (isClosed(res.status) || (res.ok && rows.length === 0)) add(`Un visiteur ne lit pas la table ${table}`, "ok");
    else add(`Un visiteur ne lit pas la table ${table}`, "fail", `Réponse ${res.status}, ${rows.length} ligne(s) lue(s). Ne mettez pas en ligne.`);
  }

  if (!secretKey) {
    add("Fondateur et liste des membres", "warn", "Non vérifiés : donnez aussi SUPABASE_SECRET_KEY pour les contrôler.");
    return checks;
  }

  const secretHeaders = { apikey: secretKey, "Content-Type": "application/json" };
  const founders = await fetcher(`${base}/rest/v1/profiles?select=gaul_number&role=eq.founder`, { headers: secretHeaders });
  const founderRows = founders.ok ? ((await founders.json()) as unknown[]) : null;
  if (founderRows === null) add("Le clan a un fondateur", "fail", `Lecture refusée (${founders.status}). Vérifiez SUPABASE_SECRET_KEY.`);
  else if (founderRows.length === 0) add("Le clan a un fondateur", "warn", "Pas encore : connectez-vous une fois sur le site, puis lancez bootstrap_founder (docs/CONQUETE.md, étape 4).");
  else add("Le clan a un fondateur", "ok");

  const roster = await fetcher(`${base}/rest/v1/app_state?select=value&key=eq.roster`, { headers: secretHeaders });
  const rosterRows = roster.ok ? ((await roster.json()) as unknown[]) : [];
  if (rosterRows.length > 0) add("La liste des membres a été relue", "ok");
  else add("La liste des membres a été relue", "warn", "Pas encore : lancez l'Action « Données et site » dans GitHub.");

  return checks;
}
