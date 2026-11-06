import { useCallback, useEffect, useState } from "preact/hooks";
import { basePath } from "../../lib/conquete/api";
import { VETERAN_LANDS, type GuideProposal, type GuideStep } from "../../lib/conquete/guide";

interface Stored {
  seen: string[];
  closed: boolean;
}

const storageKey = (number: number) => `gal-conquete-guide-${number}`;

function readStored(number: number): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey(number));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s): s is string => typeof s === "string") : [], closed: parsed.closed === true };
  } catch {
    return null;
  }
}

/**
 * Ce qu'on retient du guide : les explications déjà lues, et s'il a été fermé. Le reste se déduit de la partie.
 * Sans stockage, le guide marche quand même, et repart de ce que dit le jeu au prochain chargement.
 */
export function useGuide(number: number | null, ownedLands: number) {
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    if (number === null) {
      setStored(null);
      return;
    }
    // Quelqu'un qui tient déjà plusieurs terres n'a pas besoin qu'on le lui explique : le guide reste à portée de bouton.
    setStored(readStored(number) ?? { seen: [], closed: ownedLands >= VETERAN_LANDS });
    // Une seule lecture par joueur : les terres changent ensuite sans rouvrir le guide.
  }, [number]);

  const update = useCallback(
    (change: (current: Stored) => Stored) => {
      setStored((current) => {
        const next = change(current ?? { seen: [], closed: false });
        if (number !== null) {
          try {
            localStorage.setItem(storageKey(number), JSON.stringify(next));
          } catch {
            // Sans stockage, le guide reprendra où en est la partie.
          }
        }
        return next;
      });
    },
    [number],
  );

  return {
    ready: stored !== null,
    open: stored !== null && !stored.closed,
    seen: stored?.seen ?? [],
    ack: useCallback((id: string) => update((s) => (s.seen.includes(id) ? s : { ...s, seen: [...s.seen, id] })), [update]),
    close: useCallback(() => update((s) => ({ ...s, closed: true })), [update]),
    /** Rouvrir, c'est revoir : les explications repassent, ce qui est déjà fait dans la partie reste derrière. */
    reopen: useCallback(() => update(() => ({ seen: [], closed: false })), [update]),
  };
}

interface Props {
  step: GuideStep;
  onAck: (id: string) => void;
  onClose: () => void;
  onPropose: (proposal: GuideProposal) => void;
}

/** La carte du guide : elle se pose sur l'écran de jeu sans le bloquer, et se ferme quand on veut. */
export default function GameGuide({ step, onAck, onClose, onPropose }: Props) {
  const firstStep = step.number === 1;
  return (
    <section class="conq-panel conq-guide" data-testid="guide" aria-label="Guide de première partie">
      <div class="flex items-center justify-between gap-2">
        <p class="tnum text-xs font-bold uppercase tracking-wide text-warn" data-testid="guide-progress">
          Guide · étape {step.number} sur {step.total}
        </p>
        <button type="button" class="conq-close" aria-label="Fermer le guide" data-testid="guide-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div class="conq-guide-bar" aria-hidden="true">
        <i style={{ width: `${(step.number / step.total) * 100}%` }}></i>
      </div>
      <div aria-live="polite">
        <h2 class="conq-guide-title" data-testid="guide-title">
          {step.title}
        </h2>
        {step.body.map((line) => (
          <p key={line} class="mt-1 text-sm">
            {line}
          </p>
        ))}
      </div>
      {(step.primary || step.later || firstStep || step.id === "done") && (
        <div class="mt-2 flex flex-wrap items-center gap-2">
          {step.primary && (
            <button
              type="button"
              class="btn btn-primary !min-h-9 !py-1 !text-sm"
              data-testid="guide-primary"
              onClick={() => {
                const { proposal } = step.primary!;
                if (proposal) onPropose(proposal);
                else onAck(step.id);
              }}
            >
              {step.primary.label}
            </button>
          )}
          {step.later && (
            <button type="button" class="chip !min-h-9" data-testid="guide-later" onClick={() => onAck(step.id)}>
              {step.later}
            </button>
          )}
          {firstStep && (
            <button type="button" class="chip !min-h-9" data-testid="guide-skip" onClick={onClose}>
              Je connais déjà le jeu
            </button>
          )}
          {step.id === "done" && (
            <a class="chip !min-h-9 inline-flex items-center" href={`${basePath()}/conquete/regles`}>
              Lire les règles
            </a>
          )}
        </div>
      )}
    </section>
  );
}
