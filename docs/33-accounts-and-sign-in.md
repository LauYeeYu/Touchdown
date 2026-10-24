# 33 Accounts and sign-in

How people get into the hosted site (U3): the website signs them in itself, and only people the owner invites get an account. This replaces Cloudflare Access (Q-ACCESS). The data modes are in [32](32-modes-and-sharing.md); what the server stores for Standard mode builds on the accounts here.

## Decisions

| Decision | Status |
|---|---|
| The website handles sign-in and invitations itself. No sign-in service in front of it, so the site is not tied to one host. | Decided |
| Sign in with an email address and a password, or with Google. An account can have both. | Decided |
| Only invited people get an account. The owner makes a single-use link and sends it themselves (chat, email); the site sends no email. | Decided |
| The server runs on Cloudflare (a Worker with a D1 database) or on any machine (a Node server with a SQLite file), from one codebase. | Decided |
| Someone who is not signed in sees only the sign-in pages, and later the public share page `/p/<id>` ([32](32-modes-and-sharing.md)). The app's own files need a session too. | Decided |
| Passwords are hashed in the browser before they are sent (see Passwords). | Decided |

## People and roles

- **Owner:** runs the site. Invites people, removes them, and makes password reset links. One owner (Decided, Q-SIGNIN-DEFAULTS).
- **Member:** everyone else. Uses the app; manages their own account.

## Pages anyone can open

| Address | What it does |
|---|---|
| `/signin` | Email and password, or "Continue with Google". Afterwards the user goes where they were heading. |
| `/join/<token>` | An invitation. The user enters a name, then either an email address and a password (twice), or continues with Google. The account is made and they are signed in. |
| `/reset/<token>` | A reset link from the owner: set a new password. |
| `/setup` | The first account (the owner). Asks for the setup secret; answers "not found" once an owner exists. |

These pages are a small separate bundle with its own build entry. It holds no app code and no data. Anything else without a session: a page address goes to `/signin?next=<address>`, a file or `/api/*` request gets 401.

## Invitations

- The owner opens Settings → People → "Invite someone" and gets a link, `https://<site>/join/<token>`. It works once, for 7 days. The owner may note who it is for; the note is only for the owner's list.
- The token is 128 random bits. The server stores only its hash.
- People lists the members (name, email, how they sign in, when they last signed in) and the open invitations, which can be withdrawn.
- **Removing someone** deletes their account, sign-in methods and sessions at once, and their Standard-mode rows ([32](32-modes-and-sharing.md), Q-USER-REMOVAL). Their log stays in their own storage.

## Passwords

Decided: hashed in the browser, so the server never sees a password and a proper hash fits in Cloudflare's free plan, which allows 10 ms of computing per request.

1. The browser derives a key from the password with Argon2id (19 MiB of memory, 2 passes, the OWASP minimum), salted with the site's id and the email address (lower case). The site's id is a random value made at setup and kept in the database, so it moves with the site; the sign-in pages carry it. The salt needs no request about the account, so the sign-in page does not reveal which addresses have accounts.
2. The server stores, per account, a random salt and the SHA-256 of salt and key, and compares in constant time.
3. Someone who copies the database still has to run Argon2id for every password they try.

Rules:
- At least 10 characters; no other composition rules.
- After 5 wrong passwords in a row for an account, each further try waits: 30 seconds, doubling up to 15 minutes. Kept on the account row.
- The message is always "Wrong email or password", whether or not the address has an account.
- Changing the email address or the password asks for the current password, because the salt includes the address.
- **Forgotten password:** the owner makes a reset link for that person in People (single use, 24 hours). Someone who also signs in with Google can sign in that way and set a new password.

## Google

- OpenID Connect authorisation-code flow with PKCE, run by the server, with the scopes `openid` and `email`. `state` and `nonce` travel in a short-lived signed cookie. The server exchanges the code with the web client's secret (a server secret) and checks the ID token: Google's signature, issuer, audience (the web client id), expiry, nonce, and a verified email.
- The account is matched by Google's account id (`sub`), not by email, so a changed Gmail address keeps working.
- **Joining with Google:** the invitation's token goes through Google's sign-in in `state`, and the account is made with the Google address.
- **A Google account with no Touchdown account** is refused: "No account for this Google account. Ask the owner for an invitation."
- **Linking:** Settings → Account → "Connect Google" adds Google to a password account; "Remove" takes it away when a password is set.
- The redirect address `https://<site>/auth/google/callback` (and the development one) is registered in Google Cloud under "Authorized redirect URIs".
- This is sign-in only. Private mode's access to Google Drive is still the browser's own token for `drive.file` ([12](12-storage-and-sync.md)); Standard mode's server connection to the storage is separate ([32](32-modes-and-sharing.md)).

## Sessions

- A session is a random 256-bit token in the cookie `td_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. It lasts 30 days from the last use; the cookie is renewed at most once a day.
- The server stores the token's hash with the account, when it began and was last used, and a short device label from the browser ("Chrome on macOS") for Settings → Account → "Signed in on".
- Requests that change something (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` header naming the site.
- **Sign out** ends this session. **Sign out everywhere else** ends the others. Changing the password ends every other session.
- Signing out of the website does not remove the browser's copy of the log by itself; [31](31-ui.md), "Signing out", decides that.

## Server API

All under `/auth/` (Proposed):

| Request | Does |
|---|---|
| `POST /auth/signin` | Email and the browser's password key; sets the session cookie. |
| `GET /auth/google/start` | Sends the browser to Google (`?invite=<token>` when joining, `?link=1` when connecting Google). |
| `GET /auth/google/callback` | Google's answer; signs in, joins or links. |
| `POST /auth/join` | Invitation token, name, email, password key. |
| `POST /auth/reset` | Reset token, new password key. |
| `POST /auth/setup` | Setup secret, name, email, password key. |
| `GET /auth/me` | The signed-in account: name, email, role, sign-in methods. |
| `POST /auth/signout`, `POST /auth/signout-others` | End this session, or the others. |
| `POST /auth/password`, `POST /auth/email`, `DELETE /auth/google` | Account changes. |
| `GET /auth/people`, `POST /auth/invites`, `DELETE /auth/invites/<id>`, `DELETE /auth/people/<id>`, `POST /auth/people/<id>/reset` | Owner only. |

## Server tables

SQLite, in Cloudflare D1 or in a file next to the Node server. Defined once with the other server tables ([32](32-modes-and-sharing.md), "What the server stores"); created and upgraded by the server when it starts.

| Table | Columns |
|---|---|
| `site` | `id` (the random site id for password salts), `createdAt`, `schemaVersion` |
| `accounts` | `id`, `email` (unique, lower case), `name`, `role` (`owner`, `member`), `createdAt`, `lastSeenAt`, `failedSignins`, `lockedUntil` |
| `password_credentials` | `accountId`, `salt`, `hash`, `updatedAt` |
| `google_identities` | `accountId`, `sub` (unique), `email`, `linkedAt` |
| `sessions` | `tokenHash`, `accountId`, `createdAt`, `lastUsedAt`, `expiresAt`, `device` |
| `invites` | `tokenHash`, `purpose` (`join`, `reset`), `accountId` (for a reset), `note`, `createdBy`, `createdAt`, `expiresAt`, `usedAt`, `usedBy` |

Never stored: passwords, Google's tokens, IP addresses, request contents. No request logs.

## The first owner

The person running the site sets a long random setup secret on the server (`SETUP_TOKEN`; a Worker secret or an environment variable), opens `/setup`, enters it, and makes the owner account. Once an owner exists, `/setup` answers "not found" and the secret can be removed.

## Hosting

| Part | Cloudflare | Any machine |
|---|---|---|
| Request handler | `packages/server`: standard web `Request` and `Response` only | the same |
| Entry | Worker (`apps/web/worker/`) | Node server, behind any web server that handles HTTPS, or in Docker |
| Database | D1 | `node:sqlite`, a file |
| App files | the Worker's static assets | read from `apps/web/dist` |
| Secrets | Worker secrets: `SETUP_TOKEN`, `GOOGLE_CLIENT_SECRET`, later the token-encryption key | environment variables, same names |

Moving between them: export the SQLite tables (D1 can export to a SQL file) and import them on the other side. Sessions survive; passwords too, since the hash does not depend on the host.

The site's address (for cookies, the `Origin` check and Google's redirect) is set in the server's config.
