"use client";

/** fetch() for the platform's own REST API: JSON in, JSON out, errors as Error(message). */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body as T;
}
