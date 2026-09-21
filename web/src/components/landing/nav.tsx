"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { GitHubIcon } from "@/components/app/brand-icons";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/hacimertgokhan/denis";

/**
 * The mark: a geometric D on a black tile, with one small square inside the
 * bowl — a single stored key. No motion; it has to work at 16 px.
 */
export function DenisMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="7" fill="var(--l-ink, var(--primary))" />
      <path
        d="M9.5 8 H13.6 A6 6 0 0 1 13.6 20 H9.5 Z"
        fill="none"
        stroke="var(--l-bg, var(--primary-foreground))"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <rect x="12.2" y="12.8" width="2.4" height="2.4" rx="0.5" fill="var(--l-bg, var(--primary-foreground))" />
    </svg>
  );
}

/** Mark and a single word. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="Denis Cloud home">
      <DenisMark className="size-6" />
      <span className="text-[15.5px] font-medium tracking-[-0.01em]">Denis</span>
    </Link>
  );
}

const links: { label: string; href: string; external?: boolean }[] = [
  { label: "Benchmarks", href: "/#benchmarks" },
  { label: "Protocol", href: `${REPO}/blob/master/docs/PROTOCOL.md`, external: true },
  { label: "Security", href: "/security" },
  { label: "GitHub", href: REPO, external: true },
];

/**
 * One quiet row: the mark on the left, text links and the two actions on the
 * right. Transparent over the hero, a hairline and blur once the page scrolls.
 */
export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = (active = false) =>
    cn("px-2.5 py-1.5 text-[14px] transition-colors duration-300", active ? "text-[var(--l-ink)]" : "text-[var(--l-ash)] hover:text-[var(--l-ink)]");

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-20 transition-[background-color,border-color] duration-500",
        scrolled ? "border-b border-[var(--l-line)] bg-[var(--l-bg)]/85 backdrop-blur-md" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between px-6 lg:px-10">
        <Wordmark />
        <nav className="flex items-center gap-1" aria-label="Primary">
          {links.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className={cn(link(), "hidden items-center gap-1.5 sm:inline-flex")}>
                {l.label === "GitHub" && <GitHubIcon className="size-3.5" />}
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className={cn(link(pathname === l.href), "hidden sm:inline-block")}>
                {l.label}
              </Link>
            ),
          )}
          <span className="mx-1 hidden h-4 w-px bg-[var(--l-line)] sm:block" aria-hidden />
          <span className="[&_button]:text-[var(--l-ash)] [&_button]:hover:bg-transparent [&_button]:hover:text-[var(--l-ink)]">
            <ThemeToggle />
          </span>
          {signedIn ? (
            <Link
              href="/dashboard"
              className="ml-2 rounded-md bg-[var(--l-ink)] px-3.5 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={link()}>
                Sign in
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-md bg-[var(--l-ink)] px-3.5 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
              >
                Create a database
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
