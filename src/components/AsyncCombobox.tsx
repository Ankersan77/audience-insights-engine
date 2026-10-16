"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type ComboboxOption = {
  id: string;
  label: string;
  description?: string;
};

export type AsyncComboboxProps = {
  label: string;
  placeholder?: string;
  onSelect: (option: ComboboxOption) => void;
  search: (query: string) => Promise<ComboboxOption[]>;
  emptyMessage?: string;
  errorMessage?: string;
  minQueryLength?: number;
  /** Pre-fills the query and triggers a search on mount. Showroom/demo use only. */
  initialQuery?: string;
};

type Status = "idle" | "loading" | "error" | "empty" | "success";

const DEBOUNCE_MS = 250;

/**
 * Provider-neutral async-searchable combobox used for remote option
 * pickers (UX review required finding 6 / FR7a — the flagged highest
 * accessibility-risk component). Implements the WAI-ARIA 1.2 editable-combobox
 * pattern: `role="combobox"` on the input, `role="listbox"`/`role="option"` on
 * the popup, `aria-activedescendant` tracking keyboard highlight, and a
 * polite live region announcing result counts/errors for screen readers.
 * Keyboard: ArrowDown/ArrowUp move the highlight (opening the list if
 * closed), Enter selects the highlighted option, Escape closes the list.
 */
export function AsyncCombobox({
  label,
  placeholder,
  onSelect,
  search,
  emptyMessage = "No matches.",
  errorMessage = "Couldn't load results. Try again.",
  minQueryLength = 1,
  initialQuery,
}: AsyncComboboxProps) {
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState(initialQuery ?? "");
  const [open, setOpen] = useState(() => Boolean(initialQuery));
  const [status, setStatus] = useState<Status>("idle");
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    (q: string) => {
      if (q.trim().length < minQueryLength) {
        setStatus("idle");
        setOptions([]);
        return;
      }
      const requestId = ++requestIdRef.current;
      setStatus("loading");
      search(q)
        .then((results) => {
          if (requestIdRef.current !== requestId) return; // a newer query won the race
          setOptions(results);
          setStatus(results.length === 0 ? "empty" : "success");
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setOptions([]);
          setStatus("error");
        });
    },
    [search, minQueryLength],
  );

  // Demo/edit convenience: a pre-filled query searches immediately on mount.
  // Deferred to a timer so the effect itself never calls setState synchronously.
  useEffect(() => {
    if (!initialQuery) return;
    const timer = setTimeout(() => runSearch(initialQuery), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleInputChange(next: string) {
    setQuery(next);
    setOpen(true);
    setHighlightedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(next), DEBOUNCE_MS);
  }

  function selectOption(option: ComboboxOption) {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        runSearch(query);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        runSearch(query);
        return;
      }
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (open && highlightedIndex >= 0 && options[highlightedIndex]) {
        event.preventDefault();
        selectOption(options[highlightedIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }
  }

  const activeOptionId =
    open && highlightedIndex >= 0 && options[highlightedIndex]
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  const statusText =
    status === "loading"
      ? "Loading results…"
      : status === "error"
        ? errorMessage
        : status === "empty"
          ? emptyMessage
          : status === "success"
            ? `${options.length} result${options.length === 1 ? "" : "s"}`
            : "";

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={() => {
            if (query.trim().length >= minQueryLength) {
              setOpen(true);
              runSearch(query);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay so a mousedown on an option can register before the list closes.
            window.setTimeout(() => setOpen(false), 100);
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        />
        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-[var(--surface-raised)] py-1 shadow-lg"
          >
            {status === "loading" ? (
              <li className="px-3 py-2 text-sm text-muted" role="presentation">
                Loading…
              </li>
            ) : status === "error" ? (
              <li
                className="px-3 py-2 text-sm text-[var(--status-danger-text)]"
                role="presentation"
              >
                {errorMessage}
              </li>
            ) : status === "empty" ? (
              <li className="px-3 py-2 text-sm text-muted" role="presentation">
                {emptyMessage}
              </li>
            ) : (
              options.map((option, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={option.id}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onMouseDown={(event) => {
                    event.preventDefault(); // keep focus in the input
                    selectOption(option);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    index === highlightedIndex
                      ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]"
                      : "text-foreground"
                  }`}
                >
                  <div>{option.label}</div>
                  {option.description ? (
                    <div className="text-xs text-muted">{option.description}</div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>
    </div>
  );
}
