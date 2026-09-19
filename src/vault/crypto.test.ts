import { describe, expect, test } from "bun:test";
import { createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import {
  base32Decode,
  decryptBytes,
  decryptString,
  deriveMasterKey,
  deriveMasterPasswordHash,
  encryptBytes,
  encryptString,
  fromBase64,
  generateUserKey,
  hkdfExpand,
  makeRegistration,
  pbkdf2,
  stretchMasterKey,
  toBase64,
  totp,
  unlockWithLoginKey,
} from "./crypto";

const enc = new TextEncoder();

describe("PBKDF2", () => {
  test("matches node:crypto pbkdf2Sync for an arbitrary vector", async () => {
    const password = enc.encode("correct horse battery staple");
    const salt = enc.encode("user@example.com");
    const iterations = 10_000;
    const ours = await pbkdf2(password, salt, iterations, 32);
    const theirs = pbkdf2Sync(Buffer.from(password), Buffer.from(salt), iterations, 32, "sha256");
    expect(toBase64(ours)).toBe(theirs.toString("base64"));
  });

  test("deriveMasterKey lowercases and trims the email used as salt", async () => {
    const a = await deriveMasterKey("  User@Example.com ", "pw", 5000);
    const b = await deriveMasterKey("user@example.com", "pw", 5000);
    expect(toBase64(a)).toBe(toBase64(b));
  });

  test("masterPasswordHash is base64 of one PBKDF2 round salted with the password", async () => {
    const masterKey = await deriveMasterKey("user@example.com", "pw", 5000);
    const hash = await deriveMasterPasswordHash(masterKey, "pw");
    const expected = pbkdf2Sync(Buffer.from(masterKey), Buffer.from("pw"), 1, 32, "sha256").toString("base64");
    expect(hash).toBe(expected);
  });
});

describe("HKDF-expand", () => {
  test("our expand-only step matches bun's node:crypto hkdfSync's extract+expand, fed the same PRK", async () => {
    // hkdfExpand() implements only RFC 5869's expand stage, taking `masterKey` directly as the
    // PRK (Bitwarden's own construction). To cross-check it against `hkdfSync` — which always
    // runs extract *then* expand — we compute the RFC 5869 extract stage ourselves
    // (PRK = HMAC-SHA256(salt, ikm), salt defaulting to HashLen zero octets) and feed that PRK to
    // both our expand and to `hkdfSync` (which will redo the identical extract internally).
    const ikm = crypto.getRandomValues(new Uint8Array(32));
    const salt = new Uint8Array(32); // RFC 5869 default salt: HashLen (32) zero octets
    const info = "enc";
    const prk = new Uint8Array(createHmac("sha256", Buffer.from(salt)).update(Buffer.from(ikm)).digest());
    const ours = await hkdfExpand(prk, info, 32);
    const theirs = new Uint8Array(hkdfSync("sha256", ikm, salt, enc.encode(info), 32) as ArrayBuffer);
    expect(toBase64(ours)).toBe(toBase64(theirs));
  });
});

describe("EncString roundtrip", () => {
  test("encrypt/decrypt a string with a random userKey", async () => {
    const key = generateUserKey();
    const enc1 = await encryptString(key, "hunter2");
    expect(enc1.startsWith("2.")).toBe(true);
    expect(enc1.split("|").length).toBe(3);
    const dec = await decryptString(key, enc1);
    expect(dec).toBe("hunter2");
  });

  test("encrypt/decrypt raw bytes (used to wrap the userKey itself)", async () => {
    const wrapKey = generateUserKey();
    const payload = crypto.getRandomValues(new Uint8Array(64));
    const wrapped = await encryptBytes(wrapKey, payload);
    const unwrapped = await decryptBytes(wrapKey, wrapped);
    expect(toBase64(unwrapped)).toBe(toBase64(payload));
  });

  test("a tampered MAC is rejected before decryption is attempted", async () => {
    const key = generateUserKey();
    const encStr = await encryptString(key, "top secret");
    const [head, ct, mac] = encStr.split("|");
    const tamperedMacBytes = fromBase64(mac);
    tamperedMacBytes[0] ^= 0xff;
    const tampered = `${head}|${ct}|${toBase64(tamperedMacBytes)}`;
    await expect(decryptString(key, tampered)).rejects.toThrow(/MAC/);
  });

  test("tampered ciphertext (mac now mismatches) is also rejected", async () => {
    const key = generateUserKey();
    const encStr = await encryptString(key, "top secret");
    const [head, ct, mac] = encStr.split("|");
    const tamperedCt = fromBase64(ct);
    tamperedCt[0] ^= 0xff;
    const tampered = `${head}|${toBase64(tamperedCt)}|${mac}`;
    await expect(decryptString(key, tampered)).rejects.toThrow(/MAC/);
  });
});

describe("registration + unlock", () => {
  test("makeRegistration + unlockWithLoginKey recovers the same userKey", async () => {
    const email = "new@example.com";
    const password = "correct horse battery staple";
    const iterations = 600_000;
    const { masterPasswordHash, encUserKey, userKey } = await makeRegistration(email, password, iterations);
    expect(masterPasswordHash.length).toBeGreaterThan(0);

    // Login: re-derive the master key from the same email/password/iterations (as prelogin
    // would report), then unlock using the server's stored `encUserKey`.
    const masterKey = await deriveMasterKey(email, password, iterations);
    const recovered = await unlockWithLoginKey(masterKey, encUserKey);
    expect(toBase64(recovered)).toBe(toBase64(userKey));
  });

  test("stretchMasterKey is deterministic for the same master key", async () => {
    const masterKey = await deriveMasterKey("a@b.com", "pw", 1000);
    const a = await stretchMasterKey(masterKey);
    const b = await stretchMasterKey(masterKey);
    expect(toBase64(a)).toBe(toBase64(b));
  });
});

describe("TOTP (RFC 6238)", () => {
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")

  test("base32Decode recovers the ASCII test seed", () => {
    const bytes = base32Decode(SECRET);
    expect(new TextDecoder().decode(bytes)).toBe("12345678901234567890");
  });

  test("RFC 6238 vector at T=59s: 6-digit code is 287082", async () => {
    const code = await totp(SECRET, 59_000, 30, 6);
    expect(code).toBe("287082");
  });

  test("RFC 6238 vector at T=59s: 8-digit code is 94287082", async () => {
    const code = await totp(SECRET, 59_000, 30, 8);
    expect(code).toBe("94287082");
  });
});
