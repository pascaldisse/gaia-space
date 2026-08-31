/** Client-generated IDs must also work when the web build is served over HTTP. */
const fallbackId = (): string => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

export const newId = (): string => {
  const uuid = crypto.randomUUID?.();
  if (uuid) return uuid;
  if (!crypto.getRandomValues) return fallbackId();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export const prefixedId = (prefix: string): string => `${prefix}-${newId()}`;
