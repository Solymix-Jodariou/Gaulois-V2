import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { GameError, call, getSession, signInWithDiscord, supabase } from "../../lib/conquete/api";
import type { Me } from "../../lib/conquete/types";

export type Loadable<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export const messageOf = (e: unknown): string => (e instanceof GameError ? e.message : "Le jeu ne répond pas pour l'instant. Réessayez dans un moment.");

/** Le compte connecté. `null` tant que la session n'est pas lue. */
export function useMe(): { me: Me | null; failed: boolean; userId: string | null; refresh: () => Promise<void> } {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      setUserId(session?.user.id ?? null);
      setMe(session ? await call<Me>("get_me") : { signed_in: false });
      setFailed(false);
    } catch {
      setFailed(true);
      setMe({ signed_in: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    let unsubscribe = () => {};
    void supabase().then((sb) => {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") void refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => unsubscribe();
  }, [refresh]);

  return { me, failed, userId, refresh };
}

export function DiscordButton({ returnPath, label = "Se connecter avec Discord" }: { returnPath: string; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        class="btn btn-primary"
        data-testid="sign-in"
        onClick={() => {
          setError(null);
          signInWithDiscord(returnPath).catch((e: unknown) => setError(messageOf(e)));
        }}
      >
        {label}
      </button>
      <Problem message={error} />
    </>
  );
}

export function Problem({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <p class="conq-problem" role="alert">
      {message}{" "}
      {onRetry && (
        <button type="button" class="underline" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </p>
  );
}

export function Success({ message }: { message: string | null }) {
  return (
    <p class="conq-success" role="status">
      {message}
    </p>
  );
}

export function Loading({ label = "Lecture en cours…" }: { label?: string }) {
  return (
    <p class="text-muted" role="status">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="text-muted">{children}</p>;
}
