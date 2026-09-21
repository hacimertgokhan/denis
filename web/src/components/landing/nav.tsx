"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { GitHubIcon } from "@/components/app/brand-icons";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/hacimertgokhan/denis";

/** The mark: a prompt and a cursor, the two glyphs of a one-line protocol. */
export function DenisMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      {/* ink and paper fall back to the app theme outside .landing */}
      <rect x="1" y="1" width="26" height="26" rx="7" fill="var(--l-ink, var(--primary))" />
      <path
        d="M9 9.5 L14 14 L9 18.5"
        fill="none"
        stroke="var(--l-bg, var(--primary-foreground))"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="15.5" y="17" width="5" height="2.2" rx="1.1" fill="var(--l-bg, var(--primary-foreground))" className="dm-cursor" />
    </svg>
  );
}

/** Mark and wordmark, "Cloud" set quiet so the name reads as one word. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-3", className)} aria-label="Denis Cloud home">
      <DenisMark className="size-8 transition-transform duration-300 group-hover:-rotate-6" />
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-semibold tracking-[-0.02em]">Denis</span>
        <span className="mt-0.5 font-mono text-[10.5px] tracking-[0.18em] text-[var(--l-ash)] uppercase transition-colors duration-300 group-hover:text-[var(--l-ink)]">
          Cloud
        </span>
      </span>
    </Link>
  );
}

const links: { label: string; href: string; external?: boolean }[] = [
  { label: "Benchmarks", href: "/#benchmarks" },
  { label: "Protocol", href: `${REPO}/blob/master/docs/PROTOCOL.md`, external: true },
  { label: "Security", href: "/security" },
];

/** Wordmark left, links in the middle, actions right. Transparent until the page scrolls. */
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
    cn(
      "rounded-full px-3 py-1.5 text-[14px] transition-colors duration-300",
      active ? "bg-[var(--l-ink)]/[0.06] text-[var(--l-ink)]" : "text-[var(--l-ash)] hover:bg-[var(--l-ink)]/[0.05] hover:text-[var(--l-ink)]",
    );

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-20 transition-[background-color,border-color,box-shadow] duration-500",
        scrolled ? "border-b border-[var(--l-line)] bg-[var(--l-bg)]/85 backdrop-blur-md" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto grid h-16 max-w-[1560px] grid-cols-[1fr_auto_1fr] items-center px-6 lg:px-10">
        <Wordmark />

        <nav
          className="hidden items-center gap-0.5 rounded-full border border-[var(--l-line)]/70 bg-[var(--l-bg)]/60 p-1 backdrop-blur-sm md:flex"
          aria-label="Primary"
        >
          {links.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className={link()}>
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className={link(pathname === l.href)}>
                {l.label}
              </Link>
            ),
          )}
          <a href={REPO} target="_blank" rel="noreferrer" className={cn(link(), "inline-flex items-center gap-1.5")}>
            <GitHubIcon className="size-3.5" /> GitHub
          </a>
        </nav>

        <div className="flex items-center justify-end gap-1">
          <span className="[&_button]:text-[var(--l-ash)] [&_button]:hover:bg-transparent [&_button]:hover:text-[var(--l-ink)]">
            <ThemeToggle />
          </span>
          {signedIn ? (
            <Link
              href="/dashboard"
              className="ml-2 rounded-full bg-[var(--l-ink)] px-4 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={cn(link(), "hidden sm:inline-block")}>
                Sign in
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-full bg-[var(--l-ink)] px-4 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
              >
                Create a database
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
