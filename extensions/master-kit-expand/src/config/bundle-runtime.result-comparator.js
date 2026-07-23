export function comparePreparedFunctionResults(hardcodedResult, candidateResult) {
  const hardcoded = normalizeFunctionResult(hardcodedResult);
  const candidate = normalizeFunctionResult(candidateResult);
  const differences = [
    ...findUnsupportedFunctionResultShape(hardcodedResult, "hardcoded"),
    ...findUnsupportedFunctionResultShape(candidateResult, "snapshot"),
    ...diffValues(hardcoded, candidate),
  ];

  return {
    match: differences.length === 0,
    differences,
    hardcoded,
    snapshot: candidate,
  };
}

export function normalizeFunctionResult(result) {
  return {
    operations: (result.operations || []).map((operation) => {
      if (!operation.expand) return sortObject(operation);

      return {
        expand: {
          cartLineId: operation.expand.cartLineId,
          title: operation.expand.title,
          expandedCartItems: operation.expand.expandedCartItems.map((item) => ({
            merchandiseId: item.merchandiseId,
            quantity: item.quantity,
            attributes: normalizeAttributes(item.attributes),
            amount: item.price?.adjustment?.fixedPricePerUnit?.amount,
          })),
        },
      };
    }),
  };
}

function normalizeAttributes(attributes = []) {
  if (!attributes.length) return [];

  return [...attributes]
    .map((item) => ({ key: item.key, value: item.value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function diffValues(left, right, path = "") {
  if (Object.is(left, right)) return [];

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return [difference(path, left, right)];
    }

    const differences = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      differences.push(...diffValues(left[index], right[index], `${path}[${index}]`));
    }
    return differences;
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return [difference(path, left, right)];
    }

    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys]
      .sort()
      .flatMap((key) =>
        diffValues(left[key], right[key], path ? `${path}.${key}` : key),
      );
  }

  return [difference(path, left, right)];
}

function difference(path, hardcoded, snapshot) {
  return { path, hardcoded, snapshot };
}

/**
 * Returns structured differences for fields outside the supported Cart
 * Transform expand result contract. It only reads its input.
 */
export function findUnsupportedFunctionResultShape(result, source = "candidate") {
  const differences = [];

  (result.operations || []).forEach((operation, operationIndex) => {
    const operationPath = `operations[${operationIndex}]`;
    collectUnsupportedKeys(operation, ["expand"], operationPath, source, differences);

    if (!operation.expand) return;

    collectUnsupportedKeys(
      operation.expand,
      ["cartLineId", "title", "expandedCartItems"],
      `${operationPath}.expand`,
      source,
      differences,
    );

    (operation.expand.expandedCartItems || []).forEach((item, itemIndex) => {
      const itemPath = `${operationPath}.expand.expandedCartItems[${itemIndex}]`;
      collectUnsupportedKeys(
        item,
        ["merchandiseId", "quantity", "attributes", "price"],
        itemPath,
        source,
        differences,
      );

      if (item.price == null) return;
      collectUnsupportedKeys(item.price, ["adjustment"], `${itemPath}.price`, source, differences);

      if (item.price.adjustment == null) return;
      collectUnsupportedKeys(
        item.price.adjustment,
        ["fixedPricePerUnit"],
        `${itemPath}.price.adjustment`,
        source,
        differences,
      );

      if (item.price.adjustment.fixedPricePerUnit == null) return;
      collectUnsupportedKeys(
        item.price.adjustment.fixedPricePerUnit,
        ["amount"],
        `${itemPath}.price.adjustment.fixedPricePerUnit`,
        source,
        differences,
      );
    });
  });

  return differences;
}

function collectUnsupportedKeys(value, supportedKeys, path, source, differences) {
  if (!isPlainObject(value)) return;

  Object.keys(value)
    .filter((key) => !supportedKeys.includes(key))
    .sort()
    .forEach((key) => {
      differences.push({
        path: `${path}.${key}`,
        hardcoded: source === "hardcoded" ? value[key] : undefined,
        snapshot: source === "snapshot" ? value[key] : undefined,
        unsupported: true,
      });
    });
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = sortObject(value[key]);
      return accumulator;
    }, {});
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
