// The share page's frame (docs/32-modes-and-sharing.md, "The public page"): the wordmark, the page, and the footer
// that says where it comes from. No menus and no way into the app: a shared page shows one link and nothing else.

import type { ReactNode } from "react";
import { Icon } from "../lib/icons.tsx";
import { Wordmark } from "../components/Wordmark.tsx";

export function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="share-head">
        <div className="share-head__inner">
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main id="view" className="page share-main">
        {children}
      </main>
      <footer className="share-foot">
        <p>
          Shared from Touchdown, a log of flights and aircraft. <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a>
        </p>
      </footer>
    </>
  );
}

/** Back to the whole log's list, inside a whole-log link. */
export function Back({ href, label }: { href: string; label: string }) {
  return (
    <nav className="crumbs" aria-label="Back">
      <a href={href}>
        <Icon name="arrow-left" /> {label}
      </a>
    </nav>
  );
}

/** A record the link no longer shows: deleted from the log since. */
export function Gone({ what }: { what: string }) {
  return <Message title={what} text="It was taken out of the log it was shared from." />;
}

export function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="share-message">
      <h1 className="share-message__title">{title}</h1>
      <p className="share-message__text">{text}</p>
    </div>
  );
}
