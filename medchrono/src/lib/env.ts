/** Reads an env var, treating empty strings and the AWS template placeholder as unset. */
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v !== "REPLACE_ME" ? v : undefined;
}
