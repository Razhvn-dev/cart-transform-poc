import { run as runHardcodedCartTransform } from "./run.core.js";

const PREBUILT_PROBES = Object.freeze({
  "gid://shopify/ProductVariant/51571819708694": Object.freeze({
    title: "Prebuilt Bundle Test",
    components: Object.freeze([
      ["gid://shopify/ProductVariant/51592671756566", "50.00"],
      ["gid://shopify/ProductVariant/51592717566230", "30.00"],
      ["gid://shopify/ProductVariant/51592730706198", "20.00"],
    ]),
  }),
  "gid://shopify/ProductVariant/51592673329430": Object.freeze({
    title: "High Roller (Classic)",
    components: Object.freeze([
      ["gid://shopify/ProductVariant/51592730706198", "24.13"],
      ["gid://shopify/ProductVariant/51592666611990", "53.10"],
      ["gid://shopify/ProductVariant/51592668217622", "62.76"],
    ]),
  }),
  "gid://shopify/ProductVariant/51592717271318": Object.freeze({
    title: "Quick Draw Trans Control Module",
    components: Object.freeze([
      ["gid://shopify/ProductVariant/51592668250390", "170.61"],
      ["gid://shopify/ProductVariant/51592665825558", "115.41"],
      ["gid://shopify/ProductVariant/51592715338006", "100.36"],
      ["gid://shopify/ProductVariant/51552321175830", "173.61"],
    ]),
  }),
});

// Development-only hosted bisect. This profile deliberately avoids all
// mapping/Snapshot parsing so one approved Checkout can prove whether the
// minimal Function binding + expand operation works for the pre-built parent.
export function run(input) {
  const probeLines = (input?.cart?.lines ?? []).filter(isProbeLine);
  // Development-only invocation marker. Remove after the current hosted-runtime
  // diagnosis; it exposes only line IDs and Variant IDs, never buyer data.
  console.log(JSON.stringify({
    marker: "prebuilt-static-probe-component-breadth-v60",
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
          title: probeForLine(line).title,
          expandedCartItems: probeForLine(line).components.map(([merchandiseId, amount]) => ({
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
    && probeForLine(line) != null
    && line.quantity === 1;
}

function probeForLine(line) {
  return PREBUILT_PROBES[line?.merchandise?.id] ?? null;
}
