// AES-GCM 連線設定信封：
// - v3: base64(iv[12] || ciphertext/tag)，以 HKDF-SHA256 衍生金鑰
// - v2: base64(iv[12] || ciphertext/tag)，僅供相容既有 PBKDF2 資料
// - v1: base64(salt[16] || iv[12] || ciphertext/tag)，僅供相容既有資料

const V1_SALT_LEN = 16;
const IV_LEN = 12;
const GCM_TAG_LEN = 16;
const ITERATIONS = 210_000;
const V2_PREFIX = "v2:";
const V3_PREFIX = "v3:";
const V2_KDF_SALT = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v2:kdf",
);
const V2_ADDITIONAL_DATA = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v2",
);
const V3_KDF_SALT = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v3:kdf",
);
const V3_KDF_INFO = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v3:aes-256-gcm",
);
const V3_ADDITIONAL_DATA = new TextEncoder().encode(
  "worker-ssh:connection-envelope:v3",
);

// 快取 Promise 而非只快取完成後的 CryptoKey，避免同一 isolate 內的並行首次
// 使用重複執行金鑰衍生。
const KEY_CACHE_MAX = 16;
const keyCache = new Map<string, Promise<CryptoKey>>();
let derivedTotal = 0;

export type EnvelopeVersion = "v1" | "v2" | "v3";

export class EncryptionOperationError extends Error {
  readonly code = "ENCRYPTION_UNAVAILABLE";

  constructor() {
    super("encryption operation failed");
    this.name = "EncryptionOperationError";
  }
}

export interface DecryptedEnvelope {
  plaintext: string;
  version: EnvelopeVersion;
}

/** 測試用統計與重置 */
export function _keyCacheStats(): { size: number; derived: number } {
  return { size: keyCache.size, derived: derivedTotal };
}

export function resetKeyCache(): void {
  keyCache.clear();
  derivedTotal = 0;
}

async function cachedDerivedKey(
  cacheKey: string,
  derive: () => Promise<CryptoKey>,
): Promise<CryptoKey> {
  const cached = keyCache.get(cacheKey);
  if (cached) {
    keyCache.delete(cacheKey);
    keyCache.set(cacheKey, cached);
    return cached;
  }

  derivedTotal += 1;
  const pending = derive();

  if (keyCache.size >= KEY_CACHE_MAX) {
    const oldest = keyCache.keys().next().value;
    if (oldest !== undefined) keyCache.delete(oldest);
  }
  keyCache.set(cacheKey, pending);

  try {
    return await pending;
  } catch (error) {
    if (keyCache.get(cacheKey) === pending) keyCache.delete(cacheKey);
    throw error;
  }
}

async function derivePbkdf2Key(
  keyMaterial: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const cacheKey = `pbkdf2:${keyMaterial.length}:${keyMaterial}:${toBase64(salt)}`;
  return cachedDerivedKey(cacheKey, async () => {
    const base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(keyMaterial),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt as BufferSource,
        iterations: ITERATIONS,
        hash: "SHA-256",
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  });
}

async function deriveV3Key(keyMaterial: string): Promise<CryptoKey> {
  const cacheKey = `hkdf-v3:${keyMaterial.length}:${keyMaterial}`;
  return cachedDerivedKey(cacheKey, async () => {
    const base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(keyMaterial),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: V3_KDF_SALT as BufferSource,
        info: V3_KDF_INFO as BufferSource,
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  });
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeEnvelope(text: string, minimumLength: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    throw new Error("invalid envelope: not base64");
  }
  if (bytes.length < minimumLength) {
    throw new Error("invalid envelope: too short");
  }
  return bytes;
}

/** 新寫入一律使用 v3；每筆仍以獨立隨機 IV 保持密文不可預測。 */
export async function encryptString(
  keyMaterial: string,
  plaintext: string,
): Promise<string> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveV3Key(keyMaterial);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: V3_ADDITIONAL_DATA as BufferSource,
        tagLength: 128,
      },
      key,
      new TextEncoder().encode(plaintext),
    );
    const out = new Uint8Array(IV_LEN + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), IV_LEN);
    return `${V3_PREFIX}${toBase64(out)}`;
  } catch {
    throw new EncryptionOperationError();
  }
}

/** 解密並回報信封版本，供資料遷移判斷。 */
export async function decryptStringDetailed(
  keyMaterial: string,
  envelope: string,
): Promise<DecryptedEnvelope> {
  if (envelope.startsWith(V3_PREFIX)) {
    const bytes = decodeEnvelope(
      envelope.slice(V3_PREFIX.length),
      IV_LEN + GCM_TAG_LEN,
    );
    const iv = bytes.slice(0, IV_LEN);
    const ciphertext = bytes.slice(IV_LEN);
    const key = await deriveV3Key(keyMaterial);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: V3_ADDITIONAL_DATA as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertext as BufferSource,
    );
    return {
      plaintext: new TextDecoder().decode(plaintext),
      version: "v3",
    };
  }

  if (envelope.startsWith(V2_PREFIX)) {
    const bytes = decodeEnvelope(
      envelope.slice(V2_PREFIX.length),
      IV_LEN + GCM_TAG_LEN,
    );
    const iv = bytes.slice(0, IV_LEN);
    const ciphertext = bytes.slice(IV_LEN);
    const key = await derivePbkdf2Key(keyMaterial, V2_KDF_SALT);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: V2_ADDITIONAL_DATA as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertext as BufferSource,
    );
    return {
      plaintext: new TextDecoder().decode(plaintext),
      version: "v2",
    };
  }

  const bytes = decodeEnvelope(
    envelope,
    V1_SALT_LEN + IV_LEN + GCM_TAG_LEN,
  );
  const salt = bytes.slice(0, V1_SALT_LEN);
  const iv = bytes.slice(V1_SALT_LEN, V1_SALT_LEN + IV_LEN);
  const ciphertext = bytes.slice(V1_SALT_LEN + IV_LEN);
  const key = await derivePbkdf2Key(keyMaterial, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return {
    plaintext: new TextDecoder().decode(plaintext),
    version: "v1",
  };
}

/** 解密 v1、v2 或 v3 信封；錯誤金鑰、竄改與非法格式皆拒絕。 */
export async function decryptString(
  keyMaterial: string,
  envelope: string,
): Promise<string> {
  return (await decryptStringDetailed(keyMaterial, envelope)).plaintext;
}
