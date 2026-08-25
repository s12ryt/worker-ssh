export interface SessionObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class SshSessionInitializationError extends Error {
  constructor() {
    super("SSH session initialization failed");
    this.name = "SshSessionInitializationError";
  }
}

async function initialize(
  stub: SessionObjectStubLike,
  payload: unknown,
): Promise<string> {
  const response = await stub.fetch("https://ssh-session.internal/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new SshSessionInitializationError();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SshSessionInitializationError();
  }
  const nonce =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).nonce
      : undefined;
  if (typeof nonce !== "string" || !nonce) {
    throw new SshSessionInitializationError();
  }
  return nonce;
}

export async function connectInitializedSshSession(
  stub: SessionObjectStubLike,
  payload: unknown,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const nonce = await initialize(stub, payload);
    const response = await stub.fetch(
      `https://ssh-session.internal/connect?nonce=${encodeURIComponent(nonce)}`,
      { headers: { Upgrade: "websocket" } },
    );
    if (response.status !== 409 || attempt === 1) return response;
  }
  throw new SshSessionInitializationError();
}
