export type AllowedObjectFields = readonly string[] | ReadonlySet<string>;

const allowsField = (allowedFields: AllowedObjectFields, field: string): boolean =>
  Array.isArray(allowedFields)
    ? allowedFields.includes(field)
    : (allowedFields as ReadonlySet<string>).has(field);

/** Strict object boundary shared by WebGL's public option surfaces. */
export const objectWithAllowedFields = (
  value: unknown,
  allowedFields: AllowedObjectFields,
  label: string,
  fieldKind: "field" | "option" = "option",
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!allowsField(allowedFields, field)) {
      throw new TypeError(`${label} contains unsupported ${fieldKind} ${JSON.stringify(field)}`);
    }
  }
  return record;
};
