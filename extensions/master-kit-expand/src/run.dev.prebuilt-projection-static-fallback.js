import { run as runProjectionCandidate } from "./run.dev.prebuilt-projection-candidate.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only transition profile. The server-published compact Projection
// is the real pre-built runtime carrier. The proven static probe remains only
// for lines that the Projection candidate did not handle.
export function run(input) {
  const projectionResult = runProjectionCandidate(input);
  const handledLineIds = new Set((projectionResult?.operations ?? []).flatMap((operation) => {
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
      ...(projectionResult?.operations ?? []),
      ...(staticResult?.operations ?? []),
    ],
  };
}
