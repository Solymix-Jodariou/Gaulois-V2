import LineChart, { type LinePoint } from "./LineChart";
import { fmtInt } from "../lib/format";

const fmtPixels = (n: number) => `${fmtInt(n)} pixels`;

/** Le territoire de GAL à la fin de chaque journée terminée. Le tableau en dessous donne les mêmes chiffres. */
export default function TerritoryChart({ points }: { points: LinePoint[] }) {
  return <LineChart title="Territoire à la fin de chaque jour" points={points} format={fmtPixels} />;
}
