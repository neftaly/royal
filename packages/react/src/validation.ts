export type AllowedObjectFields = readonly string[] | ReadonlySet<string>;

const allowsField = (allowedFields: AllowedObjectFields, field: string): boolean =>
  Array.isArray(allowedFields)
    ? allowedFields.includes(field)
    : (allowedFields as ReadonlySet<string>).has(field);

/** Returns an object-like record after rejecting null, arrays, and primitives. */
export const objectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

/** Returns a public-boundary object after also rejecting unknown fields. */
export const recordWithAllowedFields = (
  value: unknown,
  allowedFields: AllowedObjectFields,
  label: string,
  fieldKind: "field" | "option" = "field",
): Record<string, unknown> => {
  const record = objectRecord(value, label);
  for (const field of Object.keys(record)) {
    if (!allowsField(allowedFields, field)) {
      throw new TypeError(
        `${label} contains unsupported ${fieldKind} ${JSON.stringify(field)}`,
      );
    }
  }
  return record;
};
