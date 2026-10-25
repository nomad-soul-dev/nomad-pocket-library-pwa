// Vérification d'intégrité des segments du corpus (SHA-256 via Web Crypto, natif navigateur).

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Garantit un ArrayBuffer "pur" (pas de SharedArrayBuffer) pour SubtleCrypto.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}
