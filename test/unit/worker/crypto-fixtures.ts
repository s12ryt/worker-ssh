function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

const V2_KDF_SALT = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v2:kdf",
);
const V2_ADDITIONAL_DATA = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v2",
);

/** 建立正式 v2 上線前的 v1 測試信封。 */
export async function encryptLegacyV1(
  keyMaterial: string,
  plaintext: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const out = new Uint8Array(16 + 12 + ciphertext.byteLength);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(new Uint8Array(ciphertext), 28);
  return toBase64(out);
}

/** 建立 Cloudflare production 尚未支援的 PBKDF2 210k v2 測試信封。 */
export async function encryptLegacyV2(
  keyMaterial: string,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: V2_KDF_SALT,
      iterations: 210_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: V2_ADDITIONAL_DATA,
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(plaintext),
  );
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return `v2:${toBase64(out)}`;
}
