"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bot protection for the public forms, matched by the server's humanCheck
 * hook: a honeypot input no person sees (the "form opened" moment is a
 * signed cookie the page itself sets, see proxy.ts), and
 * — when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set — a Cloudflare Turnstile
 * token. useHumanCheck() gives the headers to send; <HumanCheck /> renders
 * the hidden field and the widget.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; theme?: string; size?: string },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export function useHumanCheck() {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const ready = !SITE_KEY || captcha !== null;
  const headers = (): Record<string, string> => ({
    "x-form-website": honeypot,
    ...(captcha ? { "x-captcha-response": captcha } : {}),
  });
  return { headers, ready, honeypot, setHoneypot, setCaptcha };
}

export function HumanCheck({ check }: { check: ReturnType<typeof useHumanCheck> }) {
  const slot = useRef<HTMLDivElement | null>(null);
  const { setCaptcha } = check;

  useEffect(() => {
    if (!SITE_KEY || !slot.current) return;
    let widget: string | undefined;
    const el = slot.current;
    const render = () => {
      if (!window.turnstile || widget !== undefined) return;
      widget = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        theme: "auto",
        callback: (token) => setCaptcha(token),
        "expired-callback": () => setCaptcha(null),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (widget !== undefined) window.turnstile?.reset(widget);
    };
  }, [setCaptcha]);

  return (
    <>
      {/* honeypot: off-screen, not focusable, ignored by people, filled by scripts */}
      <div aria-hidden className="absolute top-auto -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={check.honeypot} onChange={(e) => check.setHoneypot(e.target.value)} />
        </label>
      </div>
      {SITE_KEY && <div ref={slot} className="min-h-[65px]" />}
    </>
  );
}
