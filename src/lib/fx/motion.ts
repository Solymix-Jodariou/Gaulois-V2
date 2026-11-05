/** Les animations sont-elles permises ? Non si le visiteur a mis en pause ou réduit les animations. */
export function motionAllowed(): boolean {
  if (typeof document === "undefined") return false;
  return (
    !document.documentElement.classList.contains("fx-off") && !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
