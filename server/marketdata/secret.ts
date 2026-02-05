export function resolveSecretRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const raw = String(ref).trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith("env:")) {
    const key = raw.slice(4).trim();
    if (!key) return null;
    const v = process.env[key];
    return v ? String(v) : null;
  }
  return raw;
}

export function isEnvSecretRef(ref: string | null | undefined): boolean {
  if (!ref) return false;
  const raw = String(ref).trim();
  return raw.toLowerCase().startsWith("env:");
}

export function envSecretKeyFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const raw = String(ref).trim();
  if (!raw.toLowerCase().startsWith("env:")) return null;
  const key = raw.slice(4).trim();
  return key ? key : null;
}
