# Touchdown privacy policy

Effective 24 October 2026.

This policy covers the Touchdown website run from this repository by its owner, for people the owner invites. It says what the site keeps about you, where your log is, and what Touchdown does with data from Google.

## In short

- Your flight and spotting log is not kept on Touchdown's server. It is in your browser and, if you choose, in your own storage (your Google Drive or a folder on your computer).
- The server keeps only what it needs to sign you in: your name, email address, a hash of your password key, your Google account id if you sign in with Google or connect Google Drive in Standard mode, and your sign-in sessions. In Standard mode, if you choose it, it also keeps an encrypted key to your Google Drive.
- Touchdown never sees your password, sells nothing and shows no ads. It counts page views with Cloudflare Web Analytics, which sets no cookies and does not identify you (see Analytics).

## What the server keeps

The server runs on Cloudflare and keeps these, per account, in its database:

| What | Why |
|---|---|
| Name and email address | To show who you are, and to sign you in. |
| Whether you are the owner or a member | The owner invites and removes people. |
| A hash of your password key | To check your password. Your browser turns the password into a key before sending it. The password itself never leaves your browser, and the server stores only a hash of the key. |
| Your Google account id and Google email address, if you sign in with Google, or connect Google Drive in Standard mode (that Google account then also signs you in) | To recognise your Google account. |
| Your sign-in sessions: a hash of each session's random token, when it began and was last used, and a short device label such as "Chrome on macOS", or "Command line on macOS" for the command-line tools | To keep you signed in, and to list where you are signed in. |
| When you last signed in, and how many wrong passwords were entered in a row | To show the owner when members were last active, and to slow down password guessing. |
| Invitation and password reset links: a hash of each link, who it was for (a note by the owner), when it was made and used | So that each link works once and expires. |
| A Google sign-in under way: random values that tie it to your browser, and where to go afterwards | To finish signing in with Google. Deleted when used, and kept 10 minutes at most. |
| Standard mode only: an encrypted key to your Google Drive, the Google account it belongs to, when it was made and last used, and whether it still works | So your browsers can sync without signing in to Google every hour (see Standard mode). |
| Standard mode only: the version of its terms you accepted, and when | To ask you again when the terms change. |

The server does not keep your IP address, and it keeps no request logs. Cloudflare, which hosts the site, handles your requests under its own [privacy policy](https://www.cloudflare.com/privacypolicy/).

The owner can see the list of members: names, email addresses, how each signs in, and when each last signed in.

## Your log

- **Standard mode:** your log is kept in your browser and synced through a Touchdown folder in your Google Drive, with access the server gives your browser (see Standard mode). The server does not keep your log.
- **Private mode:** your log is kept in your browser and synced through your own storage: a Touchdown folder in your Google Drive, or a folder on your computer. The server never receives it.
- **Local mode:** your log is kept only in your browser.
- Each account has its own copy in the browser, so people who share a browser do not see each other's logs.

## Data from Google

Touchdown uses Google in three ways, each only if you choose it:

1. **Google Drive, to sync your log (Private mode).** Touchdown asks for the `drive.file` permission, which lets it see and change only the files it creates in your Drive (a Touchdown folder) or files you pick. It cannot see your other files. The access Google gives lasts an hour and stays in your browser. It is not sent to Touchdown's server. If you give it to Touchdown's command-line tools on your computer, your browser passes it to them directly, and they keep it on your computer until the hour is over.
2. **Signing in with Google.** Touchdown asks for your Google account id and verified email address (the `openid` and `email` permissions). The server stores them to recognise your account. It does not keep any Google tokens for this.
3. **Google Drive in Standard mode.** Touchdown asks Google for lasting access to the files it creates in your Drive (`drive.file`, with offline access), and keeps that key on the server, encrypted. It is described below.

Touchdown's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google is used only to sync your own log and to sign you in. It is not used for advertising, not sold, not shared with anyone, and not used to train AI models. No person reads it, except where you ask for help with your own data or the law requires it.

You can remove Touchdown's access at any time in your Google account, under Security → Your connections to third-party apps.

## Standard mode

Standard mode is offered only after you accept its terms, which say the same as this section.

- **What the server keeps:** a key from Google (a refresh token) that opens the files Touchdown created in your Google Drive (the Touchdown folder), not your other files. With it, the server can open your whole log, including ticket numbers and booking references if you entered them. The person who runs the site could technically use the key.
- **What it is used for:** only to give your own browser short-lived access (an hour) for its sync. The server does not read, copy, analyse or keep your log.
- **How it is protected:** the key is encrypted with AES-256-GCM. The encryption key is a separate secret held with Cloudflare, not in the database. The key is never sent to a browser and never logged.
- **Stopping:** switch to Private or Local in Settings. The key is then revoked with Google and deleted from the server, with the record of the terms you accepted. Removing your account does the same. You can also remove Touchdown's access in your Google account.

## Other services your browser contacts

- **planespotters.net**, for reference photos of aircraft: your browser sends the registration of the aircraft whose page you open.
- **Google**, as above: when Google Drive is selected as your storage (the page then loads Google's sign-in), when you use Google Drive, and when you sign in with Google.
- **Cloudflare Web Analytics**, on every page, as described under Analytics.

## Analytics

The site uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to count how it is used. When a page opens, including moving between pages in the app, your browser sends Cloudflare:

- the page's address, which can name an aircraft registration, or a flight's date and airports
- the address of the site that sent you there, if any
- your browser, system and type of device, and the country your connection comes from
- how long the page took to load

It sets no cookies, keeps no profile of you, and does not tie views to your account. The owner sees totals: views per page, per country, per device, and loading times. Cloudflare handles this under its [privacy policy](https://www.cloudflare.com/privacypolicy/).

## Cookies

Touchdown sets one cookie to keep you signed in (`td_session`), and a short-lived one while you sign in with Google (`td_google`). It sets no other cookies, and the analytics set none. Your browser also stores your log and settings for the site (IndexedDB and local storage).

## Keeping and deleting

- Your account is kept until the owner removes it. Ask the owner if you want it removed. Removing it deletes your account, your sign-in methods, your sessions and any Standard mode key from the server at once.
- Your log in your own storage is yours to keep or delete there.
- Settings → "Delete all data in this browser" removes the browser's copy. Signing out removes it too in Private mode, once everything has synced.

## Changes

If this policy changes, the new version is published here with a new effective date. If Standard mode's terms change, you will be asked to accept them again before anything new applies to you.

## Contact

Contact the owner who invited you, or open an issue at [github.com/LauYeeYu/Touchdown/issues](https://github.com/LauYeeYu/Touchdown/issues).
