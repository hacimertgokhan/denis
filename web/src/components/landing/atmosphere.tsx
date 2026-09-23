"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { GrainGradient } from "@/components/ui/grain-gradient";
import { SilkAurora } from "@/components/ui/silk-aurora";
import { cn } from "@/lib/utils";

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
 * paper with a soft ash shadow by day, black with a grey light by night.
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
        colorDark={dark ? "#000000" : "#c9c7c7"}
        colorMid={dark ? "#272727" : "#f1f0f0"}
        colorLight={dark ? "#5c5959" : "#ffffff"}
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

/** The auth panel: satin-black aurora ribbons in the ash greys. */
export function AuthAtmosphere({
  children,
  intensity = 0.85,
  className = "h-full min-h-screen rounded-none",
  soft = false,
}: {
  children?: React.ReactNode;
  intensity?: number;
  className?: string;
  /** Dimmer and blurred, for panels where the text has to carry. */
  soft?: boolean;
}) {
  return (
    <SilkAurora
      className={cn(className, soft && "[&_canvas]:scale-110 [&_canvas]:opacity-70 [&_canvas]:blur-2xl")}
      baseColor="#000000"
      midColor="#1a1a1a"
      sheenColor="#f2f0f0"
      accentColor="#969393"
      intensity={soft ? Math.min(intensity, 0.5) : intensity}
      grain={0.5}
      vignette={0.9}
      speed={0.7}
      mouseInfluence={0.6}
    >
      {children}
    </SilkAurora>
  );
}
