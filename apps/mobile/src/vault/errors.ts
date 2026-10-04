/** The database file is on disk and the key is not. A new key must not be minted over it. */
export class VaultKeyMissing extends Error {
  constructor() {
    super('The key for these books is missing. They were not opened with a new key.');
    this.name = 'VaultKeyMissing';
  }
}

/** Household JSON could not be parsed. The stored file is left as it is. */
export class HouseholdUnreadable extends Error {
  constructor() {
    super('The household file could not be read. It was left as it is.');
    this.name = 'HouseholdUnreadable';
  }
}
