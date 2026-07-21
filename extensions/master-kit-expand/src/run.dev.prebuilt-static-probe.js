import { run as runHardcodedCartTransform } from "./run.core.js";

const PREBUILT_PARENT_VARIANT_GID = "gid://shopify/ProductVariant/51571819708694";
const PROBE_COMPONENTS = Object.freeze([
  ["gid://shopify/ProductVariant/51592671756566", "50.00"],
  ["gid://shopify/ProductVariant/51592717566230", "30.00"],
  ["gid://shopify/ProductVariant/51592730706198", "20.00"],
]);

// Development-only hosted bisect. This profile deliberately avoids all
// mapping/Snapshot parsing so one approved Checkout can prove whether the
// minimal Function binding + expand operation works for the pre-built parent.
export function run(input) {
  const probeLines = (input?.cart?.lines ?? []).filter(isProbeLine);
  // Development-only invocation marker. Remove after the current hosted-runtime
  // diagnosis; it exposes only line IDs and Variant IDs, never buyer data.
  console.log(JSON.stringify({
    marker: "prebuilt-static-probe-v44",
    matching_line_count: probeLines.length,
    cart_line_variant_ids: (input?.cart?.lines ?? []).map((line) => (
      line?.merchandise?.__typename === "ProductVariant" ? line.merchandise.id : null
    )),
  }));
  const hardcodedResult = runHardcodedCartTransform({
    ...input,
    cart: {
      ...input.cart,
      lines: (input?.cart?.lines ?? []).filter((line) => !isProbeLine(line)),
    },
  });

  return {
    operations: [
      ...(hardcodedResult?.operations ?? []),
      ...probeLines.map((line) => ({
        expand: {
          cartLineId: line.id,
          title: "Prebuilt Bundle Test",
          expandedCartItems: PROBE_COMPONENTS.map(([merchandiseId, amount]) => ({
            merchandiseId,
            quantity: 1,
            price: {
              adjustment: {
                fixedPricePerUnit: { amount },
              },
            },
          })),
        },
      })),
    ],
  };
}

function isProbeLine(line) {
  return line?.merchandise?.__typename === "ProductVariant"
    && line.merchandise.id === PREBUILT_PARENT_VARIANT_GID
    && line.quantity === 1;
}
