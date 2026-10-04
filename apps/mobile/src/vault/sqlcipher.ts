/** First statement after open. Hex only, so the key cannot break out of the pragma. */
export function sqlcipherKeyPragma(keyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Vault key must be 32 bytes.');
  return `PRAGMA key = "x'${keyHex}'"`;
}
