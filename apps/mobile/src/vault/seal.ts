import { gcm } from '@noble/ciphers/aes.js';

function hexFrom(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexTo(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(12);
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.getRandomValues) throw new Error('No random source for the vault.');
  cryptoRef.getRandomValues(nonce);
  return nonce;
}

function keyBytes(keyHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Vault key must be 32 bytes.');
  return hexTo(keyHex);
}

export function looksSealed(value: string): boolean {
  if (!value.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(value) as { v?: number; alg?: string };
    return parsed.v === 1 && parsed.alg === 'aes-256-gcm';
  } catch {
    return false;
  }
}

/** AES-256-GCM around one stored value. The key is not written into the blob. */
export function sealText(plain: string, keyHex: string): string {
  const nonce = randomNonce();
  const data = gcm(keyBytes(keyHex), nonce).encrypt(new TextEncoder().encode(plain));
  return JSON.stringify({ v: 1, alg: 'aes-256-gcm', nonce: hexFrom(nonce), data: hexFrom(data) });
}

export function openText(blob: string, keyHex: string): string {
  const parsed = JSON.parse(blob) as { v?: number; alg?: string; nonce?: string; data?: string };
  if (parsed.v !== 1 || parsed.alg !== 'aes-256-gcm' || !parsed.nonce || !parsed.data) {
    throw new Error('Not a sealed value.');
  }
  const plain = gcm(keyBytes(keyHex), hexTo(parsed.nonce)).decrypt(hexTo(parsed.data));
  return new TextDecoder().decode(plain);
}
