"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface GrainGradientProps {
  /** Palette accepts three- or six-digit hex colors. */
  colorLight?: string;
  colorMid?: string;
  colorDark?: string;
  /** Composition rotation in degrees. */
  angle?: number;
  /** Horizontal edge offset, -1 to 1. */
  position?: number;
  /** Bend of the shadow edge, -1 to 1. */
  curve?: number;
  /** Width of the diffused edge, 0.01 to 1. */
  softness?: number;
  /** Composition zoom, 0.25 to 3. */
  scale?: number;
  /** Grain strength, 0 to 1. */
  grain?: number;
  /** Grain size in CSS pixels, 0.5 to 4. */
  grainSize?: number;
  /** Reproducible texture seed. */
  seed?: number;
  /** Breathing speed, 0 to 2. Default 1; zero pauses the current frame. */
  speed?: number;
  className?: string;
  style?: CSSProperties;
}

const vertex = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0., 1.); }`;

const fragment = `precision highp float;
uniform vec2 u_resolution;
uniform float u_ratio, u_angle, u_position, u_curve, u_softness, u_scale;
uniform float u_grain, u_grainSize, u_seed, u_time;
uniform vec3 u_light, u_mid, u_dark;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1. - uv.y;
  vec2 p = uv - .5;
  float aspect = u_resolution.x / u_resolution.y;
  p.x *= aspect;
  float c = cos(u_angle), s = sin(u_angle);
  p = mat2(c, -s, s, c) * p;
  p.x /= aspect;
  p = p / u_scale + .5;
  // A continuous breathing cycle: the silhouette, diffusion and light move
  // together. The slower secondary wave prevents a mechanical back-and-forth.
  float breath = sin(u_time * .52);
  float undertow = sin(u_time * .31);
  float bend = u_curve + sin(u_time * .52 - .7) * .12;
  float edge = .32 + bend * pow(1. - p.y, 2.) + u_position
    + breath * .115 + undertow * .035;
  float distanceToEdge = p.x - edge
    + sin(p.y * 4. + u_time * .38) * .035;
  float diffusion = u_softness * (1. + breath * .28);
  float shadow = smoothstep(-diffusion, diffusion * .45, distanceToEdge);
  vec2 lightCenter = vec2(.04 + breath * .13, .04 + undertow * .16);
  vec2 lightUV = (p - lightCenter) * vec2(1.9, 1.7);
  float mint = exp(-dot(lightUV, lightUV));
  vec3 light = mix(u_light, u_mid, mint * (.66 + breath * .1));
  vec3 color = mix(light, u_mid * (.68 + breath * .035),
    smoothstep(-diffusion * 1.8, .02, distanceToEdge));
  color = mix(color, u_dark, shadow);
  vec2 grainUV = floor(gl_FragCoord.xy / (u_ratio * u_grainSize));
  float noise = hash(grainUV + mod(u_seed, 1000.) * 13.7) - .5;
  // Slightly stronger texture in the shadows, without a flickering noise layer.
  color += noise * u_grain * mix(.48, .32, shadow);
  gl_FragColor = vec4(clamp(color, 0., 1.), 1.);
}`;

function hex(value: string, fallback: string) {
  let clean = /^#([\da-f]{3}|[\da-f]{6})$/i.test(value)
    ? value.slice(1)
    : fallback.slice(1);
  if (clean.length === 3)
    clean = clean
      .split("")
      .map((part) => part + part)
      .join("");
  return [0, 2, 4].map(
    (offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255,
  );
}

function bounded(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Decorative WebGL background. Give the container an explicit height. */
export function GrainGradient({
  colorLight = "#dce5df",
  colorMid = "#83b9ad",
  colorDark = "#031419",
  angle = 0,
  position = 0,
  curve = 0.48,
  softness = 0.13,
  scale = 1,
  grain = 0.32,
  grainSize = 1,
  seed = 1,
  speed = 1,
  className,
  style,
}: GrainGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const updateRef = useRef<(() => void) | null>(null);
  const settings = useRef({
    colorLight,
    colorMid,
    colorDark,
    angle,
    position,
    curve,
    softness,
    scale,
    grain,
    grainSize,
    seed,
    speed,
  });

  useEffect(() => {
    settings.current = {
      colorLight,
      colorMid,
      colorDark,
      angle,
      position,
      curve,
      softness,
      scale,
      grain,
      grainSize,
      seed,
      speed,
    };
    updateRef.current?.();
  }, [
    colorLight,
    colorMid,
    colorDark,
    angle,
    position,
    curve,
    softness,
    scale,
    grain,
    grainSize,
    seed,
    speed,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
    });
    if (!gl) return;
    let dispose = () => {};
    const initialize = () => {
      const shaders: WebGLShader[] = [];
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
      };
      const vs = compile(gl.VERTEX_SHADER, vertex);
      const fs = compile(gl.FRAGMENT_SHADER, fragment);
      const program = gl.createProgram();
      const buffer = gl.createBuffer();
      const release = () => {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        shaders.forEach((shader) => gl.deleteShader(shader));
      };
      if (!vs || !fs || !program || !buffer) {
        release();
        return;
      }
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        release();
        return;
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      const attribute = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      const names = [
        "resolution",
        "ratio",
        "angle",
        "position",
        "curve",
        "softness",
        "scale",
        "grain",
        "grainSize",
        "seed",
        "time",
        "light",
        "mid",
        "dark",
      ];
      const uniforms = Object.fromEntries(
        names.map((name) => [
          name,
          gl.getUniformLocation(program, `u_${name}`),
        ]),
      );
      const scalar = (name: string, value: number) =>
        gl.uniform1f(uniforms[name] ?? null, value);
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      let visible = true;
      let frame = 0;
      let previous = 0;
      let elapsed = 0;
      let ratio = 1;
      const draw = (now: number) => {
        frame = 0;
        const config = settings.current;
        const rate = bounded(config.speed, 0, 2, 1);
        if (previous && !motion.matches)
          elapsed += Math.min((now - previous) / 1000, 0.05) * rate;
        previous = now;
        gl.uniform2f(uniforms.resolution ?? null, canvas.width, canvas.height);
        scalar("ratio", ratio);
        scalar("time", elapsed);
        scalar("angle", (bounded(config.angle, -360, 360, 0) * Math.PI) / 180);
        scalar("position", bounded(config.position, -1, 1, 0));
        scalar("curve", bounded(config.curve, -1, 1, 0.48));
        scalar("softness", bounded(config.softness, 0.01, 1, 0.13));
        scalar("scale", bounded(config.scale, 0.25, 3, 1));
        scalar("grain", bounded(config.grain, 0, 1, 0.32));
        scalar("grainSize", bounded(config.grainSize, 0.5, 4, 1));
        scalar("seed", bounded(config.seed, 0, 100000, 1));
        gl.uniform3fv(
          uniforms.light ?? null,
          hex(config.colorLight, "#dce5df"),
        );
        gl.uniform3fv(uniforms.mid ?? null, hex(config.colorMid, "#83b9ad"));
        gl.uniform3fv(uniforms.dark ?? null, hex(config.colorDark, "#031419"));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        canvas.style.opacity = "1";
        if (rate > 0 && !motion.matches && visible && !document.hidden)
          frame = requestAnimationFrame(draw);
      };
      const refresh = () => {
        cancelAnimationFrame(frame);
        previous = 0;
        if (visible && !document.hidden) frame = requestAnimationFrame(draw);
      };
      const resize = () => {
        ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        gl.viewport(0, 0, canvas.width, canvas.height);
        refresh();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        refresh();
      });
      intersection.observe(canvas);
      document.addEventListener("visibilitychange", refresh);
      motion.addEventListener("change", refresh);
      updateRef.current = refresh;
      resize();
      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        intersection.disconnect();
        document.removeEventListener("visibilitychange", refresh);
        motion.removeEventListener("change", refresh);
        updateRef.current = null;
        release();
      };
    };
    const lost = (event: Event) => {
      event.preventDefault();
      dispose();
      canvas.style.opacity = "0";
    };
    const restored = () => initialize();
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    initialize();
    return () => {
      dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative h-full w-full overflow-hidden",
        className,
      )}
      style={{
        background: `linear-gradient(${120 + angle}deg, ${colorMid} 0%, ${colorLight} 35%, ${colorDark} 75%)`,
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block size-full"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
