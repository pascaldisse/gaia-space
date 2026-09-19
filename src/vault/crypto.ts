/**
 * Bitwarden-compatible vault crypto. Pure WebCrypto (`crypto.subtle`), no deps,
 * no eval. Runs identically in the browser and in Bun's test runtime.
 *
 * Protocol (Bitwarden "password hashing / key derivation" + "cipher string"):
 *   masterKey            = PBKDF2-SHA256(password, salt=email.trim().toLowerCase(), iterations, 32B)
 *   masterPasswordHash    = base64(PBKDF2-SHA256(masterKey, salt=password, 1 iteration, 32B))
 *   stretched master key  = HKDF-expand(SHA256, prk=masterKey, info='enc') 32B
 *                         ‖ HKDF-expand(SHA256, prk=masterKey, info='mac') 32B  (64B total)
 *   userKey (account key) = 64 random bytes: enc key = bytes[0..32), mac key = bytes[32..64)
 *   EncString type 2      = `2.<b64 iv>|<b64 ct>|<b64 mac>`
 *                         = AES-256-CBC(PKCS7, encKey, iv, plaintext) ‖ HMAC-SHA256(macKey, iv‖ct)
 * Any 64-byte key (stretched master key, userKey, ...) is used the same way: bytes[0..32) is the
 * AES-256-CBC key, bytes[32..64) is the HMAC-SHA256 key. This file calls that shape `SymmetricKey`.
 */

export type SymmetricKey = Uint8Array; // 64 bytes: enc[0..32) ‖ mac[32..64)

const subtle = () => crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// --- base64 --------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Constant-time byte comparison — length is not secret (both MACs are 32 bytes), only content. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- PBKDF2 ----------------------------------------------------------------

export async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  lengthBytes = 32,
): Promise<Uint8Array> {
  const keyMaterial = await subtle().importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** `masterKey = PBKDF2-SHA256(password, salt=email.trim().toLowerCase(), iterations, 32B)`. */
export async function deriveMasterKey(email: string, password: string, iterations: number): Promise<Uint8Array> {
  const salt = textEncoder.encode(email.trim().toLowerCase());
  return pbkdf2(textEncoder.encode(password), salt, iterations, 32);
}

/** `masterPasswordHash = base64(PBKDF2-SHA256(masterKey, salt=password, 1, 32B))`. */
export async function deriveMasterPasswordHash(masterKey: Uint8Array, password: string): Promise<string> {
  const hash = await pbkdf2(masterKey, textEncoder.encode(password), 1, 32);
  return toBase64(hash);
}

// --- HKDF-expand (manual, via HMAC — RFC 5869 with prk = masterKey) --------

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await subtle().sign("HMAC", cryptoKey, data);
  return new Uint8Array(signature);
}

/**
 * RFC 5869 HKDF-expand, computed by hand: `T(1) = HMAC-SHA256(prk, info ‖ 0x01)`.
 * SHA-256's output is exactly 32 bytes, so a single HMAC call covers every length
 * this module ever asks for (<=32B) — no T(2), T(3)... chaining is needed.
 */
export async function hkdfExpand(prk: Uint8Array, info: string, lengthBytes = 32): Promise<Uint8Array> {
  if (lengthBytes > 32) throw new Error("hkdfExpand: this implementation only derives up to one SHA-256 block (32B)");
  const t1 = await hmacSha256(prk, concatBytes(textEncoder.encode(info), new Uint8Array([0x01])));
  return t1.slice(0, lengthBytes);
}

/** The 64-byte key used to wrap/unwrap the account's `userKey`: enc='enc', mac='mac' HKDF infos. */
export async function stretchMasterKey(masterKey: Uint8Array): Promise<SymmetricKey> {
  const enc = await hkdfExpand(masterKey, "enc", 32);
  const mac = await hkdfExpand(masterKey, "mac", 32);
  return concatBytes(enc, mac);
}

// --- EncString (type 2: AES-256-CBC + HMAC-SHA256) --------------------------

const ENC_STRING_TYPE = "2";

async function aesCbcKey(bytes: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return subtle().importKey("raw", bytes, { name: "AES-CBC" }, false, [usage]);
}

/** Encrypts raw bytes with a 64-byte symmetric key, producing a type-2 EncString. */
export async function encryptBytes(key: SymmetricKey, plaintext: Uint8Array): Promise<string> {
  if (key.length !== 64) throw new Error("encryptBytes: key must be 64 bytes (enc ‖ mac)");
  const encKey = key.slice(0, 32);
  const macKey = key.slice(32, 64);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const cryptoKey = await aesCbcKey(encKey, "encrypt");
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, cryptoKey, plaintext));
  const mac = await hmacSha256(macKey, concatBytes(iv, ciphertext));
  return `${ENC_STRING_TYPE}.${toBase64(iv)}|${toBase64(ciphertext)}|${toBase64(mac)}`;
}

/** Decrypts a type-2 EncString, verifying the MAC (constant-time) before decrypting. */
export async function decryptBytes(key: SymmetricKey, encString: string): Promise<Uint8Array> {
  if (key.length !== 64) throw new Error("decryptBytes: key must be 64 bytes (enc ‖ mac)");
  const [typeAndIv, ctB64, macB64] = encString.split("|");
  const dot = typeAndIv.indexOf(".");
  if (dot === -1) throw new Error("decryptBytes: malformed EncString (missing type prefix)");
  const type = typeAndIv.slice(0, dot);
  if (type !== ENC_STRING_TYPE) throw new Error(`decryptBytes: unsupported EncString type '${type}'`);
  if (!ctB64 || !macB64) throw new Error("decryptBytes: malformed EncString (expected type.iv|ct|mac)");
  const iv = fromBase64(typeAndIv.slice(dot + 1));
  const ciphertext = fromBase64(ctB64);
  const mac = fromBase64(macB64);
  const encKey = key.slice(0, 32);
  const macKey = key.slice(32, 64);
  const expectedMac = await hmacSha256(macKey, concatBytes(iv, ciphertext));
  if (!constantTimeEqual(expectedMac, mac)) throw new Error("decryptBytes: MAC verification failed");
  const cryptoKey = await aesCbcKey(encKey, "decrypt");
  const plaintext = await subtle().decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext);
  return new Uint8Array(plaintext);
}

export async function encryptString(key: SymmetricKey, text: string): Promise<string> {
  return encryptBytes(key, textEncoder.encode(text));
}

export async function decryptString(key: SymmetricKey, encString: string): Promise<string> {
  return textDecoder.decode(await decryptBytes(key, encString));
}

// --- userKey (the account's own 64-byte symmetric key) ----------------------

export function generateUserKey(): SymmetricKey {
  return crypto.getRandomValues(new Uint8Array(64));
}

export type Registration = {
  masterPasswordHash: string;
  /** EncString wrapping the random userKey under the stretched master key — this is the
   *  Vaultwarden `key` field sent at registration. */
  encUserKey: string;
  userKey: SymmetricKey;
};

/** `makeRegistration(email,password,iterations)` — everything `register()` (src/api/vault.ts) needs. */
export async function makeRegistration(email: string, password: string, iterations = 600_000): Promise<Registration> {
  const masterKey = await deriveMasterKey(email, password, iterations);
  const masterPasswordHash = await deriveMasterPasswordHash(masterKey, password);
  const stretchedKey = await stretchMasterKey(masterKey);
  const userKey = generateUserKey();
  const encUserKey = await encryptBytes(stretchedKey, userKey);
  return { masterPasswordHash, encUserKey, userKey };
}

/** Unlock: given the master key (re-derived from email+password+iterations at login) and the
 *  server's `Key` (the encrypted userKey from the token response), recover the userKey. */
export async function unlockWithLoginKey(masterKey: Uint8Array, encUserKeyFromToken: string): Promise<SymmetricKey> {
  const stretchedKey = await stretchMasterKey(masterKey);
  return decryptBytes(stretchedKey, encUserKeyFromToken);
}

// --- TOTP (RFC 6238 / RFC 4226, HMAC-SHA1) -----------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 decode (no padding required; case-insensitive; ignores stray '=' padding). */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`base32Decode: invalid character '${char}'`);
    bitBuffer = (bitBuffer << 5) | value;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bytes.push((bitBuffer >> bitsInBuffer) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  // `counter` (time-step count) fits safely in the low 32 bits for any realistic date;
  // the high 4 bytes stay zero as RFC 4226's HOTP counter (an 8-byte big-endian integer) requires.
  const view = new DataView(bytes.buffer);
  view.setUint32(4, counter >>> 0, false);
  return bytes;
}

/** RFC 6238 TOTP over HMAC-SHA1 (the only hash Bitwarden/authenticator apps use for this secret shape). */
export async function totp(secretBase32: string, now = Date.now(), period = 30, digits = 6): Promise<string> {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Math.floor(now / 1000) / period);
  const secretKey = await subtle().importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await subtle().sign("HMAC", secretKey, counterBytes(counter)));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = (binary % 10 ** digits).toString().padStart(digits, "0");
  return code;
}
