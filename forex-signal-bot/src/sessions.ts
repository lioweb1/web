/** Trading sessions in UTC hours. London 07-16, New York 12-21, overlap 12-16. */
export type Session = "OVERLAP" | "LONDON" | "NEW_YORK" | "ASIA";

export function sessionAt(ms: number): Session {
  const h = new Date(ms).getUTCHours();
  if (h >= 12 && h < 16) return "OVERLAP";
  if (h >= 7 && h < 16) return "LONDON";
  if (h >= 12 && h < 21) return "NEW_YORK";
  return "ASIA";
}
