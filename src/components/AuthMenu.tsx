import { useEffect, useState } from "preact/hooks";
import { SESSION_KEY, basePath, call, supabase } from "../lib/compte/api";
import type { Me } from "../lib/compte/types";

const LINK = "btn btn-ghost !min-h-10 !py-1.5 !text-sm whitespace-nowrap";

/**
 * L'entrée du compte dans l'en-tête, sur toutes les pages.
 * Sans session enregistrée, rien n'est chargé : un simple visiteur ne télécharge pas Supabase.
 * Masquer un lien ne protège rien : le serveur revérifie chaque action.
 */
export default function AuthMenu() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    try {
      // Au retour de Discord, la session n'est pas encore enregistrée : seul le code de l'adresse l'annonce.
      if (!localStorage.getItem(SESSION_KEY) && !new URLSearchParams(location.search).has("code")) return;
    } catch {
      return;
    }
    let unsubscribe = () => {};
    let stopped = false;
    void supabase().then((sb) => {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") setMe(null);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      if (stopped) unsubscribe();
    });
    call<Me>("get_me")
      .then((data) => setMe(data.signed_in ? data : null))
      .catch(() => setMe(null));
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, []);

  const base = basePath();
  if (!me) {
    return (
      <a href={`${base}/compte`} class={LINK} data-testid="auth-sign-in">
        Se connecter
      </a>
    );
  }

  const canDirect = (me.rank ?? 0) >= 2;
  return (
    <>
      {canDirect && (
        <a href={`${base}/direction`} class={LINK} data-testid="auth-direction">
          Direction
        </a>
      )}
      {/* Sur téléphone, la place manque : un officier garde « Direction », et son compte s'ouvre depuis cet espace. */}
      <span class={canDirect ? "hidden sm:inline-flex" : "inline-flex"}>
        <a href={`${base}/compte`} class={LINK} data-testid="auth-account" title={me.name}>
          <span class="block max-w-24 truncate sm:max-w-32">{me.name ?? "Mon compte"}</span>
        </a>
      </span>
    </>
  );
}
