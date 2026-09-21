"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { GitHubIcon } from "@/components/app/brand-icons";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/hacimertgokhan/denis";

/** Wordmark, three links, one action. Transparent until the page scrolls. */
export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = "rounded-md px-2.5 py-1.5 text-[14px] text-[var(--l-ash)] transition-colors duration-300 hover:text-[var(--l-ink)]";

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-20 transition-[background-color,border-color] duration-500",
        scrolled ? "border-b border-[var(--l-line)] bg-[var(--l-bg)]/85 backdrop-blur-md" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between px-6 lg:px-10">
        <Link href="/" className="text-[15px] font-medium tracking-tight">
          Denis Cloud
        </Link>
        <nav className="flex items-center gap-1">
          <a className={cn(link, "hidden sm:inline-block")} href={`${REPO}/blob/master/docs/PROTOCOL.md`} target="_blank" rel="noreferrer">
            Protocol
          </a>
          <a className={cn(link, "hidden sm:inline-block")} href={`${REPO}/blob/master/docs/BENCHMARKS.md`} target="_blank" rel="noreferrer">
            Benchmarks
          </a>
          <a className={cn(link, "inline-flex items-center gap-1.5")} href={REPO} target="_blank" rel="noreferrer">
            <GitHubIcon className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <span className="[&_button]:text-[var(--l-ash)] [&_button]:hover:bg-transparent [&_button]:hover:text-[var(--l-ink)]">
            <ThemeToggle />
          </span>
          {signedIn ? (
            <Link href="/dashboard" className="ml-2 rounded-md bg-[var(--l-ink)] px-3.5 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={link}>
                Sign in
              </Link>
              <Link href="/register" className="ml-1 rounded-md bg-[var(--l-ink)] px-3.5 py-1.5 text-[14px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90">
                Create a database
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
