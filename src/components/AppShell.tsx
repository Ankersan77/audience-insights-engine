"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Role } from "@/src/lib/auth";

const NAV_ITEMS = [
  { label: "Ask / Projects", href: "/projects" },
  { label: "Market Twin", href: "/workspace" },
  { label: "Company context", href: "/company" },
  { label: "Campaign Studies", href: "/campaigns" },
  { label: "Sources & Setup", href: "/configuration" },
  { label: "Quality", href: "/evaluation" },
] as const;

export type AppShellUser = { name: string; role: Role; clientSlug?: string };

// Used only where no real session exists yet (e.g. /showroom, which is not
// behind sign-in). A real page passes its own `user` from `requireSession()`.
const SHOWROOM_PLACEHOLDER_USER: AppShellUser = { name: "Showroom", role: "admin" };

function UserBadge({ user }: { user: AppShellUser }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--nav-text)]">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--button-primary-bg)] text-xs font-semibold text-[var(--button-primary-text)]"
      >
        {user.name.charAt(0)}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-medium">{user.name}</span>
        <span className="text-xs text-muted capitalize">{user.role}</span>
        {user.clientSlug ? <span className="text-xs text-muted">{user.clientSlug}</span> : null}
      </span>
      <form action="/api/auth/logout" method="post">
        <button className="ml-2 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">Sign out</button>
      </form>
    </div>
  );
}

/**
 * Shared navigation shell: a left nav that collapses to a hamburger-triggered
 * panel below 768px, and a top bar carrying the signed-in user. Colour comes
 * only from `src/styles/tokens.css` (via the `--nav-*` custom properties and
 * the existing Tailwind colour utilities); no component-level overrides.
 */
export function AppShell({
  children,
  user = SHOWROOM_PLACEHOLDER_USER,
}: {
  children: ReactNode;
  /** The signed-in user, from `requireSession()` on the server. Falls back to a showroom placeholder when omitted. */
  user?: AppShellUser;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 py-3 md:hidden">
        <button
          type="button"
          aria-expanded={navOpen}
          aria-controls="app-nav"
          onClick={() => setNavOpen((open) => !open)}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-[var(--nav-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <span className="sr-only">
            {navOpen ? "Close navigation" : "Open navigation"}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            {navOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
        <UserBadge user={user} />
      </header>

      <nav
        id="app-nav"
        aria-label="Primary"
        className={`${navOpen ? "flex" : "hidden"} w-full flex-col gap-1 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-2 pb-3 md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-6`}
      >
        <div className="hidden px-3 pb-4 text-xs font-semibold tracking-widest text-muted uppercase md:block">
          Market Research
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                active
                  ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]"
                  : "text-[var(--nav-text)] hover:bg-[var(--nav-active-bg)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="mt-auto hidden pt-4 md:block">
          <UserBadge user={user} />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
