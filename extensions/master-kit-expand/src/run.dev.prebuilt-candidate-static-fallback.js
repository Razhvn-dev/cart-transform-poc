import { run as runPrebuiltCandidate } from "./run.dev.prebuilt-candidate.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only transition profile. A complete server-owned candidate takes
// precedence; the proven static probe remains available only for cart lines that
// did not produce any candidate or Shared Core operation. This permits a real
// pilot to be introduced without taking the existing regression probe offline.
export function run(input) {
  const candidateResult = runPrebuiltCandidate(input);
  const handledLineIds = new Set((candidateResult?.operations ?? []).flatMap((operation) => {
    const cartLineId = operation?.expand?.cartLineId;
    return typeof cartLineId === "string" && cartLineId.length > 0 ? [cartLineId] : [];
  }));
  const staticResult = runStaticProbe({
    ...input,
    cart: {
      ...input?.cart,
      lines: (input?.cart?.lines ?? []).filter((line) => !handledLineIds.has(line?.id)),
    },
  });

  return {
    operations: [
      ...(candidateResult?.operations ?? []),
      ...(staticResult?.operations ?? []),
    ],
  };
}
