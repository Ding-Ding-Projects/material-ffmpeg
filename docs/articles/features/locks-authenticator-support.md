# Local locks, authenticator, and Support Tickets

## Behavior

Each rendered element can receive its own opt-in password or TOTP toy lock. Locks are independent: unlocking one does not unlock another. A lock can last for the current surface, a selected number of minutes, or until the page closes. Locked destinations remain visible in search and ask for the corresponding credential when selected.

This is a user-experience speed bump, not a security boundary, encryption system, or protection from another person using the browser profile. Clearing this site's browser storage removes every lock and credential record.

The built-in authenticator accepts an `otpauth://` URI or manual Base32 details, implements RFC 6238 over RFC 4226, supports SHA-1/SHA-256/SHA-512, 6–8 digits, and configurable periods, and shows the current code, next code, and a text countdown. Secrets remain in local browser storage and are excluded from ordinary exports. Browser storage does not provide the operating-system credential-vault guarantees used by the installed desktop application.

Support Tickets is a local fictional recovery surface. It creates a local ticket number, category, severity, status, and canned response, then explains how to clear site data. Nothing is sent anywhere, no ticket exists outside this browser, no network request is made, no data is collected, and nobody is reading it. It never deletes browser data for the user.

## Configuration

Create a lock from an element's context menu or keyboard appearance menu. For TOTP, verify a current code before enabling the lock. Authenticator entries can be named, grouped, reordered, searched, and removed through the two-key confirmation flow.

## Failure modes

- A wrong code produces rate-limited factual feedback and names the site-data reset route.
- An unsupported algorithm, invalid Base32 value, invalid period, or malformed URI is rejected before storage.
- If Web Crypto is unavailable, code generation remains unavailable and the existing entry is preserved.
- A QR import or camera flow that the browser cannot provide stays visibly unavailable with its exact limitation; it is never simulated.

## Security and privacy

No secret is logged, copied into history, included in ordinary export, captured, or transmitted. A separately named clear-secret export requires the two-key confirmation and warns that the resulting file contains usable secrets.

## Verification

Verification covers RFC vectors, period rollover, current/next display, no-network behavior, URI and manual registration, wrong-code handling, independent locks, expiry, relock, recovery disclosure, ordinary export redaction, and the destructive confirmation boundary.

## Suggested articles

- [Browser-only boundaries](browser-boundaries.md)
- [Exports and bulk actions](exports-and-bulk-actions.md)
- [Notifications, schedules, and history](notifications-schedules-history.md)
