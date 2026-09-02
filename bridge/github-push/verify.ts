const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signatureFor(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `sha256=${hex(new Uint8Array(signature))}`;
}

/** Length-independent work is intentionally avoided; callers compare a fixed SHA-256 digest. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyGitHubSignature(secret: string, body: string, supplied: string | null): Promise<boolean> {
  if (!supplied?.startsWith("sha256=")) return false;
  return timingSafeEqual(await signatureFor(secret, body), supplied);
}
