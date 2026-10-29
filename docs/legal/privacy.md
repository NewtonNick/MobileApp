# Privacy

This text describes how the app behaves today. A lawyer should review it before a store listing.

Books stay on this phone. There is no cloud household ledger and no required account. Forecasts run on the phone.

When the database file is encrypted, the books are encrypted at rest. A development build that cannot open SQLCipher seals each stored value instead, and release builds refuse to open in that mode. The web preview keeps books in memory only and saves nothing.

The PIN stays in the device keystore, not in the household file. A backup file is encrypted with a passphrase you choose. If you forget the PIN and have no backup, the household cannot be opened.

Erase everything deletes the database file, the PIN, and other secrets on this phone. It does not call the bank-link service. Device enrollment is not built.

ZIP is used only for public cost tables. The app does not ask for a street address or a VIN.

Bank link is optional. If you link a bank, Plaid receives the connection under their end-user privacy policy. This app does not sell household data.

A bank-link plan, when Google Play lists one, is billed by Google Play. The price is the one Play shows. It is not stored in the household file. Erase everything does not cancel that subscription.

The app is for adults 18 and older. To delete what is stored here, use Erase everything. That is also the request path for access and deletion when the books never leave the phone.

This is a planner, not a bank, and not financial advice.
