import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export const CART_TRANSFORM_FUNCTION_HANDLE = "master-kit-expand";

export async function ensureCartTransformEnabled(admin: AdminApiContext) {
  const existing = await admin.graphql(
    `#graphql
      query CartTransformStatus {
        cartTransforms(first: 10) {
          nodes {
            id
            functionId
          }
        }
      }`,
  );
  const existingJson = await existing.json();

  if (existingJson.data?.cartTransforms?.nodes?.length) {
    return {
      status: "already_enabled" as const,
      cartTransforms: existingJson.data.cartTransforms.nodes,
    };
  }

  const createResponse = await admin.graphql(
    `#graphql
      mutation EnableCartTransform($functionHandle: String!) {
        cartTransformCreate(functionHandle: $functionHandle) {
          cartTransform {
            id
            functionId
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        functionHandle: CART_TRANSFORM_FUNCTION_HANDLE,
      },
    },
  );
  const createJson = await createResponse.json();
  const userErrors = createJson.data?.cartTransformCreate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      status: "error" as const,
      userErrors,
    };
  }

  return {
    status: "created" as const,
    cartTransform: createJson.data?.cartTransformCreate?.cartTransform,
  };
}
