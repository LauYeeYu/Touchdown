// The share page's frame while the link opens, or when it does not: the app's masthead with the wordmark alone, a
// message, and the footer (docs/32-modes-and-sharing.md, "The public page"). Once the link is open, its pages have the
// app's own frame (Shell.tsx).

import type { ReactNode } from "react";
import { Wordmark } from "../components/Wordmark.tsx";
import { SiteFoot } from "./Shell.tsx";

export function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="masthead">
        <div className="page masthead__bar">
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main id="view" className="page share-main">
        {children}
      </main>
      <SiteFoot />
    </>
  );
}

export function Message({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <div className="share-message">
      <h1 className="share-message__title">{title}</h1>
      <p className="share-message__text">{text}</p>
      {onRetry && (
        <button type="button" className="btn btn--quiet btn--small share-message__retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
