import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import styles from "./SectionHeading.module.css";

/**
 * A heading with a link to its section. Selecting the link puts it in the
 * address bar and copies it (with the current filters) to share.
 */
export default function SectionHeading({ as: Tag = "h2", id, className, children }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copyLink() {
    const url = new URL(window.location.href);
    url.hash = id;
    navigator.clipboard?.writeText(url.href).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      },
      // The link is still in the address bar
      () => {},
    );
  }

  const name = typeof children === "string" ? children : "this section";
  return (
    <Tag id={id} className={clsx(styles.heading, className)}>
      {children}
      <a href={`#${id}`} className={clsx(styles.link, copied && styles.shown)} onClick={copyLink} aria-label={`Copy link to ${name}`} title="Copy link to this section">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6.5 9.5l3-3" />
          <path d="M7.5 4.5l1-1a2.83 2.83 0 0 1 4 4l-1 1" />
          <path d="M8.5 11.5l-1 1a2.83 2.83 0 0 1-4-4l1-1" />
        </svg>
      </a>
      <span className={styles.status} role="status">
        {copied ? "Link copied" : ""}
      </span>
    </Tag>
  );
}

// Scroll to the section named in the address bar once the page's data has
// rendered: the browser looked for it on load, before it existed.
export function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return undefined;
    // Wait for the charts to measure their width and take their full height
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}
