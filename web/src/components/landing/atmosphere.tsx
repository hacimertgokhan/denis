"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { GrainGradient } from "@/components/ui/grain-gradient";
import { SilkAurora } from "@/components/ui/silk-aurora";

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  return mounted;
}

/**
 * A breathing light field behind the landing hero, in the page palette:
 * fog and a warm honey light by day, graphite with the same light by night.
 * Rendered only on the client (WebGL) and never on top of content.
 */
export function HeroAtmosphere() {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted) return null;
  const dark = resolvedTheme === "dark";
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <GrainGradient
        className="absolute inset-0 h-full w-full"
        colorDark={dark ? "#1b1e24" : "#e6e8ec"}
        colorMid={dark ? "#262a32" : "#f2f3f5"}
        colorLight={dark ? "#4a4030" : "#f7efdd"}
        angle={-18}
        position={0.35}
        curve={0.25}
        softness={0.7}
        scale={1.4}
        grain={dark ? 0.35 : 0.22}
        grainSize={1.2}
        speed={0.5}
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[var(--l-bg)]" />
    </div>
  );
}

/** The auth panel: satin-dark aurora ribbons in ink and honey. */
export function AuthAtmosphere({ children }: { children: React.ReactNode }) {
  return (
    <SilkAurora
      className="h-full min-h-screen rounded-none"
      baseColor="#111318"
      midColor="#1b1e24"
      sheenColor="#ecd9b0"
      accentColor="#d9931f"
      intensity={0.85}
      grain={0.5}
      vignette={0.9}
      speed={0.7}
      mouseInfluence={0.6}
    >
      {children}
    </SilkAurora>
  );
}
