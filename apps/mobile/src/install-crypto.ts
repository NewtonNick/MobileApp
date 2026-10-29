import { getRandomValues } from 'expo-crypto';

/** Hermes has no Web Crypto. Vault sealing and @noble/hashes both call `crypto.getRandomValues`. */
const current = globalThis.crypto;
if (typeof current?.getRandomValues !== 'function') {
  const target = (current ?? {}) as Crypto;
  Object.defineProperty(target, 'getRandomValues', {
    value: getRandomValues,
    configurable: true,
    writable: true,
  });
  if (!current) {
    Object.defineProperty(globalThis, 'crypto', {
      value: target,
      configurable: true,
    });
  }
}
