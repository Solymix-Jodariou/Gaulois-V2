import { useEffect, useRef, useState } from "preact/hooks";
import { motionAllowed } from "../lib/fx/motion";

interface Props {
  value: number | null;
  format: (n: number | null) => string;
  duration?: number;
  testId?: string;
}

/**
 * Nombre qui défile jusqu'à sa nouvelle valeur. Les lecteurs d'écran reçoivent
 * uniquement la valeur finale, sans annonce à chaque étape.
 */
export default function AnimatedNumber({ value, format, duration = 550, testId }: Props) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (value === null || from === null || from === value || !motionAllowed()) {
      current.current = value;
      setShown(value);
      return;
    }
    const begin = performance.now();
    let raf = 0;
    const step = (t: number) => {
      // L'horodatage d'une image peut précéder de peu `begin` : jamais de progression négative.
      const p = Math.max(0, Math.min(1, (t - begin) / duration));
      const next = p >= 1 ? value : from + (value - from) * (1 - (1 - p) ** 3);
      current.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <>
      <span aria-hidden="true" data-testid={testId}>
        {format(shown)}
      </span>
      <span class="sr-only">{format(value)}</span>
    </>
  );
}
