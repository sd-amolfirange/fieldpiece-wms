import { Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

// Section 6.1: `/` focuses search; finds serials, claim IDs, RMA numbers and customer names.
// TODO: replace the naive routing below with a typeahead backed by GET /search?q=.

export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (/^CLM-/i.test(q)) navigate(`/claims/${encodeURIComponent(q.toUpperCase())}`);
    else if (/^\d{9}$/.test(q)) navigate(`/units/${q}`);
    else navigate(`/claims?q=${encodeURIComponent(q)}`);
  };

  return (
    <form role="search" onSubmit={onSubmit} className="relative hidden w-full max-w-md md:block">
      <label htmlFor="global-search" className="sr-only">
        {t("header.search")}
      </label>
      <Search
        size={16}
        strokeWidth={1.75}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-700"
        aria-hidden
      />
      <input
        ref={inputRef}
        id="global-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("header.search")}
        aria-keyshortcuts="/"
        className="h-10 w-full rounded border-0 bg-ink-0 pe-10 ps-9 text-body text-ink-1000 placeholder:text-ink-500 focus:ring-2 focus:ring-ink-1000"
      />
      <kbd
        className="absolute end-3 top-1/2 -translate-y-1/2 rounded-sm border border-ink-300 px-1.5 font-mono text-xs text-ink-500"
        title={t("header.searchShortcut")}
      >
        /
      </kbd>
    </form>
  );
}
