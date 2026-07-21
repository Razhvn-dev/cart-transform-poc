# Development Real Bundle Demo Candidate — 2026-07-21

## Purpose

This is the first clean, real-catalogue development demo candidate for Bundle Admin.
It is intentionally limited to a quantity-one source relationship and does not
publish a Runtime Snapshot, activate a Cart Transform, alter inventory, or touch
production.

## Verified development-store identities

Target: `cart-transform-poc-dev` on `huang-mvqquz1p.myshopify.com`.

| Role | SKU | Shopify product | Shopify variant |
| --- | --- | --- | --- |
| Parent | `AF4005PK` | `gid://shopify/Product/10638462877974` | `gid://shopify/ProductVariant/51592671789334` |
| Component | `AF4005P` ×1 | `gid://shopify/Product/10638462877974` | `gid://shopify/ProductVariant/51592671756566` |
| Component | `AF2009P` ×1 | `gid://shopify/Product/10638465335574` | `gid://shopify/ProductVariant/51592717566230` |

All three identities were read from the development store on 2026-07-21 and are
`ACTIVE`. The source relationship is record `AF4005PK` in the Bundles.app full
catalogue preflight and has no quantity or identity finding.

## Creation boundary

After the development app containing the new Create development Bundle form is
released, create a new Definition with:

```text
slug: real-af4005pk-pressure-sensor-demo
parent product GID: gid://shopify/Product/10638462877974
parent variant GID: gid://shopify/ProductVariant/51592671789334
```

Creation persists only the Definition. The required next step is a draft revision
whose fixed component selection resolves to `AF4005P ×1` and `AF2009P ×1`; this
must be validated and reviewed before any separately approved publish or Checkout
test.

## Legacy-record boundary

The Bundle Admin list currently contains historical development and rehearsal
Definitions. They are not this real demo candidate. Do not delete them through a
generic Metaobject mutation: their associated audit/rehearsal resources must first
be classified and removed through a development-only, read-back-verified cleanup
operation.
