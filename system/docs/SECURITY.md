# Security model — 7 layers per tier

## Frontend (PWA)

1. **Strict Content-Security-Policy** (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) served by the API; no inline scripts.
2. **XSS-safe rendering** — React escaping only, no `dangerouslySetInnerHTML`; uploaded HTML/SVG/JS are rejected server side, downloads sent with `nosniff` and a sandbox CSP.
3. **Token hygiene** — access token (15 min) kept in memory only; refresh token is an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. Nothing sensitive in `localStorage` (only the selected company/branch id and theme).
4. **CSRF defence** — cookie-authenticated endpoints require the `X-Requested-With: kcs-web` header (not settable cross-site) in addition to SameSite.
5. **Permission-aware UI** — menus, buttons and dashboard widgets are rendered from the user's effective permissions (server is still the authority).
6. **Session control** — idle auto sign-out (configurable), forced password change on first login, sign-out revokes the whole token family.
7. **No business data cached offline** — the service worker caches only the app shell; every `/api` call is `NetworkOnly`, responses carry `Cache-Control: no-store`.

## Backend (API)

1. **Hardened HTTP** — Helmet headers, CORS allow-list, body size limits, `x-powered-by` off, Permissions-Policy, binds to `127.0.0.1` by default.
2. **Rate limiting & brute-force protection** — global throttling, stricter login/refresh limits, account lockout after N failures (configurable), constant-time responses for unknown users.
3. **Authentication** — Argon2id password hashing (OWASP parameters), password policy, JWT (HS256, issuer-pinned, short-lived), rotating refresh tokens with reuse detection (stolen token ⇒ family revoked).
4. **Authorization (RBAC + ACL)** — 326 fine-grained permissions, roles per company, user ↔ company/branch assignments, row-level data scope (ALL / COMPANY / BRANCH / OWN), field-level permissions (e.g. salary), privilege-escalation guard when editing roles, tenant isolation on every query, relation ownership checks (IDOR protection).
5. **Input validation** — zod schemas for every payload (unknown keys stripped), lookup/relation existence checks, magic-byte file sniffing (executables/scripts blocked), path-traversal-safe storage, formula-injection-safe exports, SSRF allow-list for Hostinger, header-injection-safe e-mail.
6. **Cryptography** — AES-256-GCM field encryption (tax IDs, NIK, bank accounts, phone numbers, secrets), encrypted file storage with SHA-256 integrity check, HMAC blind index helper, encrypted backups.
7. **Audit & monitoring** — immutable audit trail (before/after diff) written in the same transaction as the change, activity log for every mutating request, login, export and download, request IDs, sanitized error responses (no stack traces / SQL).

## Database (PostgreSQL)

1. **Least privilege** — runtime role `kcs_app` has DML only (no DDL, not owner, `NOINHERIT`, connection limit); migrations run as `kcs_owner`; public schema privileges revoked.
2. **Append-only audit** — `UPDATE/DELETE/TRUNCATE` revoked on audit & activity tables plus a trigger that blocks modification even for the owner.
3. **Accounting integrity** — posted journals must balance (CHECK), debit/credit sign checks, trigger forbids editing/deleting posted or voided journals, fiscal period locking.
4. **Constraints** — foreign keys, unique keys per company, value CHECKs (amounts, rates, dates, sizes).
5. **Encrypted sensitive columns** — ciphertext only at rest (`v1:iv:tag:data`), unreadable without the application key.
6. **Resource guards** — `statement_timeout` and `idle_in_transaction_session_timeout` on the app role; parameterised queries only (Prisma / tagged templates).
7. **Backups** — `npm run db:backup` produces AES-256-GCM encrypted dumps with retention; restore script included.

## Operational recommendations

* `pg_hba.conf` on this PC currently uses `trust` for localhost. Change `trust` to `scram-sha-256` and restart PostgreSQL so database passwords are enforced (the generated `.env` already contains strong passwords).
* Keep `apps/api/.env` private and backed up separately (it holds the encryption key — without it encrypted data and backups cannot be recovered).
* **Rotate the Hostinger API token that was shared in chat**, then store the new one only in *System → Settings → integration* (it is encrypted in the database).
* Schedule `npm run db:backup` daily (Windows Task Scheduler).
