import { useEffect, useId, useRef, useState } from "react";
import styles from "./InfoTip.module.css";

// An "i" button that explains something, shown on hover, keyboard focus or tap.
export default function InfoTip({ label, children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span
      className={styles.root}
      ref={rootRef}
      onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}>
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        // Open on tap or click (closed by tapping elsewhere, Escape or moving away),
        // and on keyboard focus only: a tap also focuses the button.
        onClick={() => setOpen(true)}
        onFocus={(event) => event.currentTarget.matches(":focus-visible") && setOpen(true)}
        onBlur={() => setOpen(false)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.75" r="1" fill="currentColor" />
          <path d="M8 7.25v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={id} className={styles.tooltip}>
          {children}
        </span>
      )}
    </span>
  );
}
