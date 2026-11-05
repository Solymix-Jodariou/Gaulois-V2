/**
 * Le seul point de contact entre le navigateur et le serveur du jeu.
 * Le code de Supabase n'est chargé que sur les pages du jeu.
 * Rien de ce qui s'affiche ici ne protège quoi que ce soit : chaque fonction du serveur
 * revérifie l'appelant. Masquer un bouton n'est qu'une politesse.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "./errors";

export const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
export const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_KEY ?? "";
/** Sans ces deux réglages, le site reste entièrement statique et le jeu n'apparaît pas. */
export const GAME_ENABLED = SUPABASE_URL !== "" && SUPABASE_KEY !== "";

export const PROOFS_BUCKET = "donation-proofs";
export const PROOF_MAX_BYTES = 2 * 1024 * 1024;
export const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const basePath = (): string => import.meta.env.BASE_URL.replace(/\/$/, "");

export class GameError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(errorMessage(code, detail));
  }
}

let client: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: "gal-conquete-session" },
    }),
  );
  return client;
}

/** Appelle une fonction du serveur. Lève une GameError au message en français si elle refuse. */
export async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await supabase();
  let response: Awaited<ReturnType<SupabaseClient["rpc"]>>;
  try {
    response = await sb.rpc(fn, args);
  } catch {
    throw new GameError("network");
  }
  const { data, error } = response;
  if (error) throw new GameError(error.code === "42501" ? "not_signed_in" : "network");
  const result = data as ({ ok?: boolean; error?: string; detail?: unknown } & T) | null;
  if (result?.ok === false) throw new GameError(result.error ?? "network", result.detail);
  return result as T;
}

/** Une action de jeu : l'identifiant de demande empêche qu'un double envoi agisse deux fois. */
export const newRequestId = (): string => crypto.randomUUID();

export async function getSession(): Promise<Session | null> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signInWithDiscord(returnPath: string): Promise<void> {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${location.origin}${basePath()}${returnPath}` },
  });
  if (error) throw new GameError("network");
}

export async function signOut(): Promise<void> {
  const sb = await supabase();
  await sb.auth.signOut();
}

/** Dépose une capture dans le dossier du membre. Le serveur refuse tout autre dossier. */
export async function uploadProof(userId: string, file: File): Promise<string> {
  const sb = await supabase();
  const extension = file.type.split("/")[1] ?? "png";
  const path = `${userId}/${newRequestId()}.${extension}`;
  const { error } = await sb.storage.from(PROOFS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new GameError("invalid_screenshot");
  return path;
}

export async function proofUrl(path: string): Promise<string | null> {
  const sb = await supabase();
  const { data } = await sb.storage.from(PROOFS_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/** Efface une capture après une décision. Si cela échoue, la collecte quotidienne s'en charge. */
export async function removeProof(path: string): Promise<void> {
  try {
    const sb = await supabase();
    await sb.storage.from(PROOFS_BUCKET).remove([path]);
  } catch {
    // La file d'effacement du serveur prend le relais.
  }
}
