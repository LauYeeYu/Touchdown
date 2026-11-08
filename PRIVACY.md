# Touchdown privacy policy

Effective 7 November 2026.

This policy covers the Touchdown website run from this repository by its owner, for people the owner invites. It says what the site keeps about you, where your log is, and what Touchdown does with data from Google.

## In short

- Your flight and spotting log is not kept on Touchdown's server. It is in your browser and, if you choose, in your own storage (your Google Drive or a directory on your computer).
- The server keeps only what it needs to sign you in: your name, email address, a hash of your password key, your Google account id if you sign in with Google or connect Google Drive in Standard mode, and your sign-in sessions. In Standard mode, if you choose it, it also keeps an encrypted key to your Google Drive.
- In Standard mode you can share links to a flight, a sighting, an aircraft or your whole log. Anyone with a link can open it. The server reads what the link shows from your Google Drive when it is opened, and keeps only the link itself, how often it was opened and a preview of it for chat apps (see Share links).
- Touchdown never sees your password, sells nothing and shows no ads. It counts page views with Cloudflare Web Analytics, which sets no cookies and does not identify you (see Analytics).

## What the server keeps

The server runs on Cloudflare and keeps these, per account, in its database:

| What | Why |
|---|---|
| Name and email address | To show who you are, and to sign you in. |
| The interface's language you chose in Settings, if you chose one | So a share link opens in your language in any browser where you are signed in. |
| Whether you are the owner or a member, and when the owner suspended your account, if they did | The owner invites, suspends and removes people. |
| A hash of your password key | To check your password. Your browser turns the password into a key before sending it. The password itself never leaves your browser, and the server stores only a hash of the key. |
| Your Google account id and Google email address, if you sign in with Google, or connect Google Drive in Standard mode (that Google account then also signs you in) | To recognise your Google account. |
| Your sign-in sessions: a hash of each session's random token, when it began and was last used, and a short device label such as "Chrome on macOS", or "Command line on macOS" for the command-line tools | To keep you signed in, and to list where you are signed in. |
| When you last signed in, and how many wrong passwords were entered in a row | To show the owner when members were last active, and to slow down password guessing. |
| Invitation and password reset links: a hash of each link, who it was for (a note by the owner), when it was made and used | So that each link works once and expires. |
| A Google sign-in under way: random values that tie it to your browser, and where to go afterwards | To finish signing in with Google. Deleted when used, and kept 10 minutes at most. |
| Standard mode only: an encrypted key to your Google Drive, the Google account it belongs to, the id of your Touchdown directory in it, when it was made and last used, and whether it still works | So your browsers can sync without signing in to Google every hour, and your links can be opened (see Standard mode). |
| Standard mode only: your share links. For each, a random id, what it shows (a flight, a sighting or an aircraft by its id in your log, or the whole log), when it was made, and how often and when it was last opened | To open your links, and to show you how they are used. Who opened a link is not kept. |
| Standard mode only: a preview of each link, which your browser makes: a title (such as "XY401: London to New York", or for a whole log your name), a line under it (such as the date, the aircraft type and the distance) and a picture of its map | So a chat app or a site the address is pasted into shows what the link opens. Deleted with the link. |
| Standard mode only: the version of its terms you accepted, and when | To ask you again when the terms change. |

The server does not keep your IP address, and it keeps no request logs. Cloudflare, which hosts the site, handles your requests under its own [privacy policy](https://www.cloudflare.com/privacypolicy/).

The owner can see the list of members: names, email addresses, how each signs in, and when each last signed in.

## Your log

- **Standard mode:** your log is kept in your browser and synced through a Touchdown directory in your Google Drive, with access the server gives your browser (see Standard mode). The server does not keep your log, only each link's preview. When someone opens one of your links, it reads the part the link shows (see Share links).
- **Private mode:** your log is kept in your browser and synced through your own storage: a Touchdown directory in your Google Drive, or a directory on your computer. The server never receives it.
- **Local mode:** your log is kept only in your browser.
- **Daily copies:** in Standard and Private mode, your browser also keeps copies of your whole log in your Touchdown directory (`backups/`), on days it changed: the log as it was at the end of each of the last 7 days, 8 weeks and 12 months, and of each year before. They hold everything the log does, ticket numbers and booking references included. They stay in your storage, and the server does not read them. You can delete them there.
- Each account has its own copy in the browser, so people who share a browser do not see each other's logs.

## Data from Google

Touchdown uses Google in four ways, each only if you choose it:

1. **Google Drive, to sync your log (Private mode).** Touchdown asks for the `drive.file` permission, which lets it see and change only the files it creates in your Drive (a Touchdown directory) or files you pick. It cannot see your other files. The access Google gives lasts an hour and stays in your browser. It is not sent to Touchdown's server. If you give it to Touchdown's command-line tools on your computer, your browser passes it to them directly, and they keep it on your computer until the hour is over.
2. **Signing in with Google.** Touchdown asks for your Google account id and verified email address (the `openid` and `email` permissions). The server stores them to recognise your account. It does not keep any Google tokens for this.
3. **Google Drive in Standard mode.** Touchdown asks Google for lasting access to the files it creates in your Drive (`drive.file`, with offline access), and keeps that key on the server, encrypted. It is used for your sync and for the links you share, as described below.
4. **Exporting to Google Sheets.** When you ask for it in Settings, your browser puts your flights, sightings and aircraft in a new Google Sheet in your Drive, with the same `drive.file` permission: in Standard mode with the access the server gives your browser, in Private mode with your browser's own sign-in, and otherwise with an hour's access from Google's sign-in for that one export, which stays in your browser. The tables go from your browser to Google. Touchdown's server does not receive them.

Touchdown's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google is used only to sync your own log, to show the links you share to the people you send them to, to put the Google Sheets you ask for in your Drive, and to sign you in. It is not used for advertising, not sold, not shared with anyone, and not used to train AI models. No person reads it, except where you ask for help with your own data or the law requires it.

You can remove Touchdown's access at any time in your Google account, under Security → Your connections to third-party apps.

## Standard mode

Standard mode is offered only after you accept its terms, which say the same as this section.

- **What the server keeps:** a key from Google (a refresh token) that opens the files Touchdown created in your Google Drive (the Touchdown directory), not your other files. With it, the server can open your whole log, including ticket numbers and booking references if you entered them. The person who runs the site could technically use the key.
- **What it is used for:** to give your own browser short-lived access (an hour) for its sync, and, when someone opens one of your links, to read the part of your log that link shows. The server does not read, copy, analyse or keep your log for anything else.
- **Private data apart:** ticket numbers and booking references are kept in their own files in your Touchdown directory (`private/`), and in the daily copies of your log there (`backups/`, see Your log). A link never reads either.
- **How it is protected:** the key is encrypted with AES-256-GCM. The encryption key is a separate secret held with Cloudflare, not in the database. The key is never sent to a browser and never logged.
- **Stopping:** switch to Private or Local in Settings. Your links stop at once, and the key is revoked with Google and deleted from the server, with your links and the record of the terms you accepted. Removing your account does the same. You can also remove Touchdown's access in your Google account.

## Share links

In Standard mode you can share a link to a flight, a sighting, an aircraft or your whole log. You manage them on the Shared links page.

- **Who can open a link:** anyone who has its address, without signing in, until you stop it. The address is random and cannot be guessed from the record.
- **What it shows:** that page, read-only, with the notes and photo links on it. Never a ticket number or booking reference, never an entry you deleted, and nothing else from your log. A whole-log link shows every flight, sighting and aircraft, and your name as your account has it, in its title and sentences ("Sam's log", "Sam has flown 12 flights").
- **How it works:** when the link is opened, the server reads the files the link needs from your Touchdown directory with the key above, picks out what the link shows and sends only that. It keeps the result in Cloudflare's cache for up to a day, under the version of the files it came from, so the next opening is quicker. Your log itself stays in your Google Drive.
- **Preview:** when you make a link, your browser makes its preview: a title, a line under it and a picture of its map, from what the link shows. The server keeps it with the link and puts it in the page, so a chat app or a site the address is pasted into shows it. Anyone who sees the address sees the preview, as they could open the link. Your browser makes it again once a day after syncing, when what the link shows has changed. It is deleted with the link.
- **What is recorded:** how many times a link was opened and when last. Not who opened it. A chat app reading the preview is not counted.
- **The page:** a link's page is not indexed by search engines, tells the next site nothing about where it was opened, and has no analytics. Other than a whole log's pages, it names nobody: a link to a flight, a sighting or an aircraft does not say whose log it is. The browser of the person opening it contacts planespotters.net for aircraft photos, as yours does. It sets no cookies. While it is open, it keeps where each page was scrolled, the page's choices (such as the year shown) and the photos it found in that tab's session storage, which goes when the tab is closed.

## Other services your browser contacts

- **planespotters.net**, for reference photos of aircraft: your browser sends the registration of the aircraft whose page you open.
- **Google**, as above: when Google Drive is selected as your storage (the page then loads Google's sign-in), when you use Google Drive, when you export to Google Sheets, and when you sign in with Google.
- **Cloudflare Web Analytics**, on every page except a share link's page, as described under Analytics.

## Analytics

The site uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to count how it is used. When a page opens, including moving between pages in the app, your browser sends Cloudflare the following. A share link's page sends nothing.

- the page's address, which can name an aircraft registration, or a flight's date and airports
- the address of the site that sent you there, if any
- your browser, system and type of device, and the country your connection comes from
- how long the page took to load

It sets no cookies, keeps no profile of you, and does not tie views to your account. The owner sees totals: views per page, per country, per device, and loading times. Cloudflare handles this under its [privacy policy](https://www.cloudflare.com/privacypolicy/).

## Cookies

Touchdown sets one cookie to keep you signed in (`td_session`), and a short-lived one while you sign in with Google (`td_google`). It sets no other cookies, and the analytics set none. Your browser also stores your log and settings for the site (IndexedDB and local storage), and a copy of the app's own files, so that it opens without a connection. Signing out removes that copy.

## Keeping and deleting

- Your account is kept until the owner removes it. Ask the owner if you want it removed. Removing it deletes your account, your sign-in methods, your sessions, any Standard mode key and your share links with their previews from the server at once. The owner can also suspend your account: your sessions end, you cannot sign in and your links do not open, but everything is kept until the owner reinstates the account or removes it.
- A share link is kept until you stop it, leave Standard mode or your account is removed.
- Your log in your own storage is yours to keep or delete there.
- Settings → "Delete all data in this browser" removes the browser's copy. Signing out removes it too in Private mode, once everything has synced.

## Changes

If this policy changes, the new version is published here with a new effective date. If Standard mode's terms change, you will be asked to accept them again before anything new applies to you.

## Contact

Contact the owner who invited you, or open an issue at [github.com/LauYeeYu/Touchdown/issues](https://github.com/LauYeeYu/Touchdown/issues).
