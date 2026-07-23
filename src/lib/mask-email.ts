export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.indexOf(".");
  const label = dot === -1 ? domain : domain.slice(0, dot);
  const rest = dot === -1 ? "" : domain.slice(dot);

  const mask = (part: string) =>
    part.length <= 1 ? part : part[0] + "*".repeat(Math.min(part.length - 1, 5));

  return `${mask(local)}@${mask(label)}${rest}`;
}

/** Enmascara salvo que `allowed` sea true — mismo criterio que /api/users y /api/team. */
export function maskEmailUnless(email: string, allowed: boolean): string {
  return allowed ? email : maskEmail(email);
}
