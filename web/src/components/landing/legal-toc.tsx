"use client";

import { useEffect, useState } from "react";

/** "On this page": built from the article's h2 headings after mount, sticky on wide screens. */
export function LegalToc() {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const heads = Array.from(document.querySelectorAll<HTMLHeadingElement>("article.legal h2"));
      setItems(
        heads.map((h, i) => {
          if (!h.id)
            h.id =
              `s-${i + 1}-` +
              (h.textContent ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");
          return { id: h.id, text: h.textContent ?? "" };
        }),
      );
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (items.length === 0) return null;
  return (
    <nav aria-label="On this page" className="text-[13px]">
      <p className="font-medium tracking-[0.08em] text-[var(--l-ash)] uppercase">On this page</p>
      <ol className="mt-3 grid gap-1.5 border-l border-[var(--l-line)]">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className="-ml-px block border-l border-transparent py-0.5 pl-3 text-[var(--l-ash)] transition-colors hover:border-[var(--l-ink)] hover:text-[var(--l-ink)]"
            >
              {i.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
