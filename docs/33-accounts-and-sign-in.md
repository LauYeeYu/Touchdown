# 33 Accounts and sign-in

How people get into the hosted site (U3): the website signs them in itself, and only people the owner invites get an account. This replaces Cloudflare Access (Q-ACCESS). The data modes are in [32](32-modes-and-sharing.md); what the server stores for Standard mode builds on the accounts here.

## Decisions

| Decision | Status |
|---|---|
| The website handles sign-in and invitations itself. No sign-in service in front of it, so the site is not tied to one host. | Decided |
| Sign in with an email address and a password, or with Google. An account can have both. | Decided |
| Only invited people get an account. The owner makes a single-use link and sends it themselves (chat, email); the site sends no email. | Decided |
| The server runs on Cloudflare (a Worker with a D1 database) or on any machine (a Node server with a SQLite file), from one codebase. | Decided |
| Someone who is not signed in sees only the sign-in pages, the privacy policy and the terms, and later the public share page `/p/<id>` ([32](32-modes-and-sharing.md)). The app's own files need a session too. | Decided |
| Passwords are hashed in the browser before they are sent (see Passwords). | Decided |
| Built: the server (`packages/server`), the sign-in pages (`apps/web/signin.html`, `src/signin/`), Settings → Account and People, the Cloudflare Worker and the Node server. | Built |

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
| `/privacy`, `/terms` | The privacy policy and the terms of service: static pages built from `PRIVACY.md` and `TERMS.md` at the repository root (`apps/web/policies.ts`), so the files stay the only source. Google's consent screen links to them. |

These pages are a small separate bundle with its own build (`vite.signin.config.ts`), served from `/signin-files/`. It holds no app code and no data. Anything else without a session: a page address goes to `/signin?next=<address>`, a file or `/api/*` request gets 401. An address whose decoded path holds `..`, a backslash or an escaped slash is refused before the gate looks at it, so a public path cannot lead to a private file.

## Invitations

- The owner opens Settings → People → "Invite someone" and gets a link, `https://<site>/join/<token>`. It works once, for 7 days. The owner may note who it is for; the note is only for the owner's list.
- With the link comes a message to send with it, with "Copy message" (built, `apps/web/src/lib/invitation.ts`): the link and when it ends, then the command line's first steps (cloning the code, `./touchdown login`, `./touchdown storage drive`, `./touchdown spot`, and a sentence to give an agent to use `./touchdown add`).
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

- OpenID Connect authorisation-code flow with PKCE, run by the server, with the scopes `openid` and `email`. A sign-in under way is a row in `google_logins` (its state, nonce and PKCE verifier), used once within 10 minutes; a cookie holding the state ties it to the browser that started it, so a sign-in begun elsewhere cannot be finished here. The server exchanges the code with the web client's secret (a server secret). The ID token comes straight from Google's token endpoint over HTTPS, so its signature is not checked, as OpenID Connect allows; its issuer, audience (the web client id), expiry, nonce and verified email are.
- The account is matched by Google's account id (`sub`), not by email, so a changed Gmail address keeps working.
- **Joining with Google:** the invitation and the name typed on the invitation page go with the sign-in under way, and the account is made with the Google address.
- **A Google account with no Touchdown account** is refused: "No account for this Google account. Ask the owner for an invitation."
- **Linking:** Settings → Account → "Connect Google" adds Google to a password account; "Remove" takes it away when a password is set. Connecting Google Drive for Standard mode links that Google account as well, when the account has none yet and no other account uses it (built).
- The redirect address `https://<site>/auth/google/callback` (and the development one) is registered in Google Cloud under "Authorized redirect URIs".
- This is sign-in only. Private mode's access to Google Drive is still the browser's own token for `drive.file` ([12](12-storage-and-sync.md)); Standard mode's server connection to the storage is separate ([32](32-modes-and-sharing.md)).

## Sessions

- A session is a random 256-bit token in the cookie `td_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. It lasts 30 days from the last use; the cookie is renewed at most once a day.
- The server stores the token's hash with the account, when it began and was last used, and a short device label from the browser ("Chrome on macOS") for Settings → Account → "Signed in on".
- Requests that change something (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` header naming the site.
- **Sign out** ends this session. **Sign out everywhere else** ends the others, the command line's included. Each other device under "Signed in on" has its own **Sign out** (built). Changing the password ends every other session.
- Signing out of the website does not remove the browser's copy of the log by itself; [31](31-ui.md), "Signing out", decides that.

## The command line

Decided, built. The command line (`./touchdown`) signs in to the site as a browser does, through the site's own sign-in, so no Google client secret is handed out and the command line reaches Google Drive the way the web app does.

1. `./touchdown login` (the hosted site, set in the CLI's code and kept equal to the deployment's `SITE_ORIGINS` by a test; `./touchdown login SITE` for another, such as the dev server) listens on 127.0.0.1 at a free port and opens `/cli/login?challenge=…&system=…&port=…&state=…` in the browser. The page is behind the sign-in like any other.
2. The page names the account and what the command line can do. **Allow** asks the server for a one-time code (`POST /auth/cli/approve`, with the browser's session; the code is stored hashed, with the PKCE challenge, for 5 minutes) and sends the browser to `http://127.0.0.1:<port>/?code=…&state=…`. **Cancel** sends `error=cancelled`. The page only ever sends to 127.0.0.1.
3. The command line checks the state and exchanges the code with its PKCE verifier (`POST /auth/cli/token`) for a session token. The code works once. This request needs no `Origin`: the command line holds no cookie, so there is nothing to forge.
4. The session has kind `cli` and the device label "Command line on macOS" (the system only, not the computer's name). It does not run out: it lasts until `./touchdown logout`, **Sign out** on its row in Settings, or **Sign out everywhere else**. The token is kept in `data/private/touchdown-session.json`, readable only by the user, sent as `Authorization: Bearer`, and never printed.
5. It may only ask `GET /auth/me`, `POST /auth/signout`, `GET /api/storage` and `POST /api/storage/token`. Anything else, the app's pages and files included, is refused, so a copied token cannot change the account, invite people or open the app. A command line's token works only as a bearer token, and a browser's only as its cookie.

Google Drive for the command line:

| Mode | How the command line gets access |
|---|---|
| Standard | `POST /api/storage/token` with its session, as the browser does: an hour's access, with no browser, so an agent can run unattended. |
| Private | The browser hands it over. The command line opens `/cli/drive?port=…&state=…` (with `account=` once it knows the account). **Give access** gets an hour's access from Google in the browser, with the web app's own client and `drive.file`, and posts it in a form to `http://127.0.0.1:<port>/`, never to the server. The command line keeps it in `data/private/google-access.json` until it runs out, then opens the page again. The security policy allows forms to `http://127.0.0.1:*` for this. |
| A folder | No access needed: `./touchdown storage folder PATH`. |

Both use the web app's Google client, so the command line reaches the same files as the web app ([21](21-import-export.md), "Getting a session to the web app").

## Server API

All under `/auth/` (built):

| Request | Does |
|---|---|
| `GET /auth/site` | The site's id (for password salts), whether setup is needed, whether Google is on, whether signed in. |
| `GET /auth/invite/<token>` | What a link is for (`join` or `reset`; for a reset, the address). |
| `POST /auth/signin` | Email and the browser's password key; sets the session cookie. |
| `GET /auth/google/start` | Sends the browser to Google (`?invite=<token>` when joining, `?link=1` when connecting Google). |
| `GET /auth/google/callback` | Google's answer; signs in, joins or links. |
| `POST /auth/join` | Invitation token, name, email, password key. |
| `POST /auth/reset` | Reset token, new password key. |
| `POST /auth/setup` | Setup secret, name, email, password key. |
| `GET /auth/me` | The signed-in account: name, email, role, sign-in methods (with when the password was last changed), and its sessions (an id, the device, whether it is the command line's). |
| `POST /auth/signout`, `POST /auth/signout-others` | End this session, or the others. |
| `POST /auth/sessions/end` | End one of the account's sessions, by its id from `/auth/me` (the hash of its token, which does not open it). |
| `POST /auth/cli/approve` | The browser allows the command line: a one-time code for its PKCE challenge ("The command line"). |
| `POST /auth/cli/token` | The command line's code and verifier; returns its session token. |
| `POST /auth/name`, `POST /auth/password`, `POST /auth/email`, `DELETE /auth/google` | Account changes. |
| `GET /auth/people`, `POST /auth/invites`, `DELETE /auth/invites/<id>`, `DELETE /auth/people/<id>`, `POST /auth/people/<id>/reset` | Owner only. |

## Server tables

SQLite, in Cloudflare D1 or in a file next to the Node server. Defined in `packages/server/src/db.ts`, with the other server tables to come ([32](32-modes-and-sharing.md), "What the server stores"); created by the server when it starts.

| Table | Columns |
|---|---|
| `site` | `id` (the random site id for password salts), `createdAt`, `schemaVersion` |
| `accounts` | `id`, `email` (unique, lower case), `name`, `role` (`owner`, `member`), `createdAt`, `lastSeenAt`, `failedSignins`, `lockedUntil` |
| `password_credentials` | `accountId`, `salt`, `hash`, `updatedAt` |
| `google_identities` | `accountId`, `sub` (unique), `email`, `linkedAt` |
| `sessions` | `tokenHash`, `accountId`, `createdAt`, `lastUsedAt`, `expiresAt`, `device`, `kind` (`cli` for the command line) |
| `cli_logins` | `codeHash`, `accountId`, `challenge`, `system`, `createdAt`, `expiresAt`: the command line's sign-ins under way |
| `invites` | `id`, `tokenHash`, `purpose` (`join`, `reset`), `accountId` (for a reset), `note`, `createdBy`, `createdAt`, `expiresAt`, `usedAt`, `usedBy` |

| `google_logins` | `stateHash`, `nonce`, `verifier`, `next`, `invite`, `name`, `linkAccountId`, `expiresAt`, `purpose` (`signin` or `storage`, for Standard): Google sign-ins under way |

Standard mode's tables (`storage_connections`, `consents`) are in [32](32-modes-and-sharing.md), "What the server stores". The server's schema version is in `site`; version 2 added them and `google_logins.purpose`, version 3 `sessions.kind` and `cli_logins`, and the server upgrades an older database when it starts.

Never stored: passwords, Google's tokens, IP addresses, request contents. No request logs.

## The browser's copy

Built: each account has its own IndexedDB database in the browser, `touchdown-<account id>`, so people who share a browser never see each other's logs. The app asks the server who is signed in when it opens; offline, it opens the last account's copy. Signing out ([31](31-ui.md), "Signing out"): in Private mode, once every change has reached the storage, the account's database is deleted; with changes not synced yet, or in Local mode (the only copy), it stays.

## The first owner

The person running the site sets a long random setup secret on the server (`SETUP_TOKEN`; a Worker secret or an environment variable), opens `/setup`, enters it, and makes the owner account. Once an owner exists, `/setup` answers "not found" and the secret can be removed.

## Hosting

| Part | Cloudflare | Any machine |
|---|---|---|
| Request handler | `packages/server`: standard web `Request` and `Response` only | the same |
| Entry | Worker (`apps/web/worker/`, config `apps/web/wrangler.jsonc`) | `npm run serve` (`packages/server/src/serve.ts`), behind any web server that handles HTTPS |
| Database | D1 | `node:sqlite`, a file |
| App files | the Worker's static assets | read from `apps/web/dist` |
| Settings | `SITE_ORIGINS` and `GOOGLE_CLIENT_ID` in `wrangler.jsonc`; Worker secrets `SETUP_TOKEN`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY` (Standard mode's encryption key, [32](32-modes-and-sharing.md)) | environment variables: `TOUCHDOWN_ORIGINS`, `TOUCHDOWN_DB`, `PORT`, `HOST`, `SETUP_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY` |

Moving between them: export the SQLite tables (D1 can export to a SQL file) and import them on the other side. Sessions survive; passwords too, since the hash does not depend on the host.

The site's address (for cookies, the `Origin` check and Google's redirect) is set in the server's config. Cloudflare's static assets serve files at exactly their names (`html_handling: none`), as the Node server does.

### Setting up on Cloudflare

GitHub Actions tests and builds every push to `master`, and deploys the Worker while the repository variable `DEPLOY` is `on`. Once:

1. **Domain:** the domain's nameservers point to Cloudflare.
2. **Database:** create a D1 database named `touchdown` (Storage & databases → D1) and put its id in `apps/web/wrangler.jsonc` (`database_id`). The id is not a secret.
3. **Deploying:** a Cloudflare API token from the "Edit Cloudflare Workers" template, with Account → D1 → Edit added, limited to the account and the domain. In GitHub (Settings → Secrets and variables → Actions): the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then the variable `DEPLOY` set to `on`.
4. **Secrets** (Workers & Pages → touchdown → Settings → Variables and Secrets, type Secret): `SETUP_TOKEN` (a long random string; until it is set nobody can make the first account), `GOOGLE_CLIENT_SECRET` (the web client's secret, for Google sign-in and Standard mode), `TOKEN_KEY` (`openssl rand -base64 32`; without it Standard is not offered; keep it, since a new one makes every Standard key unreadable).
5. **Google Cloud:** in the "Touchdown web" client, the site's address under Authorized JavaScript origins and `<address>/auth/google/callback` under Authorized redirect URIs. The consent screen published ("In production") before others use Google.
6. **First account:** `<address>/setup` with the setup secret ("The first owner").

### Setting up on any machine

Build the app and run the server behind a web server that handles HTTPS (Caddy, nginx):

```sh
npm ci && npm run build -w @touchdown/web
TOUCHDOWN_ORIGINS=https://touchdown.example.org SETUP_TOKEN=… npm run serve
```

It listens on 127.0.0.1:8787 and keeps accounts in `data/private/server.sqlite`; Standard mode also needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_KEY`. The other settings are at the top of `packages/server/src/serve.ts`.

## Development

- The dev server (`npm run dev -w @touchdown/web`) runs the real server for `/auth/` with its own database, `data/private/dev-server.sqlite`, and opens the sign-in pages at their addresses. The setup secret is made on first start in `data/private/dev-setup-token.txt`. Google sign-in works when the web client's secret is in `data/private/google-client-secret.txt`.
- The rest of the dev server is not behind the sign-in: without signing in, the app uses the browser's database from before accounts existed. `npm run serve` runs the built app behind the sign-in, like the hosted site.
