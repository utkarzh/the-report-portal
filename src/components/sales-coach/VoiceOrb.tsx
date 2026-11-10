'use client'

import { useEffect, useRef, useState } from 'react'

// The live coaching call's orb: a glassy sphere of flowing colour, drawn by a
// WebGL fragment shader (domain-warped 3D simplex noise on a lit sphere, with a
// rim light, a highlight and a soft outer glow). Its palette and speed follow
// the call (calm blue while listening, cyan while the executive speaks, fast
// violet while thinking, vivid magenta and orange while the coach speaks), and
// it swells and ripples with the live audio level, read from `levelRef` every
// frame. Without WebGL it falls back to an animated CSS orb in the same colours.

export type OrbMode = 'connecting' | 'listening' | 'user' | 'thinking' | 'coach' | 'ended'

type Palette = { colors: [string, string, string, string]; speed: number; saturation: number }

export const ORB_PALETTES: Record<OrbMode, Palette> = {
  connecting: { colors: ['#1e1b4b', '#312e81', '#4338ca', '#6366f1'], speed: 0.18, saturation: 0.55 },
  listening: { colors: ['#1e1b4b', '#2563eb', '#06b6d4', '#8b5cf6'], speed: 0.3, saturation: 1 },
  user: { colors: ['#083344', '#0891b2', '#22d3ee', '#a5f3fc'], speed: 0.55, saturation: 1 },
  thinking: { colors: ['#2e1065', '#7c3aed', '#ec4899', '#60a5fa'], speed: 1.1, saturation: 1 },
  coach: { colors: ['#4c1d95', '#db2777', '#f97316', '#a78bfa'], speed: 0.65, saturation: 1 },
  ended: { colors: ['#111827', '#374151', '#4b5563', '#6b7280'], speed: 0.1, saturation: 0.25 },
}

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uFlow;
uniform float uLevel;
uniform float uSat;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  float unit = 0.5 * min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / unit;
  float r = length(p);
  float ang = atan(p.y, p.x);

  // The edge breathes slowly and ripples with the voice.
  float wobble = snoise(vec3(cos(ang) * 1.4, sin(ang) * 1.4, uTime * 0.7)) * (0.01 + 0.055 * uLevel);
  float radius = 0.64 + 0.012 * sin(uTime * 1.3) + 0.06 * uLevel + wobble;

  vec3 glowColor = mix(uC2, uC3, 0.5);
  // Fades out before the canvas edge, so a loud moment never shows a square.
  float glow = exp(-max(r - radius, 0.0) * 5.5) * (0.32 + 0.55 * uLevel) * smoothstep(1.0, 0.8, r);
  float aa = 1.5 / unit;
  float inside = smoothstep(radius, radius - aa, r);
  if (inside <= 0.0) {
    gl_FragColor = vec4(glowColor * glow, glow);
    return;
  }

  // A lit sphere: the normal at this point of the disc.
  float z = sqrt(max(radius * radius - r * r, 0.0));
  vec3 n = normalize(vec3(p, z));
  vec3 q = n * 1.55;
  float t = uFlow;

  // Domain-warped flow of colour across the surface.
  vec3 w = vec3(
    snoise(q + vec3(0.0, 0.0, t)),
    snoise(q + vec3(5.2, 1.3, t * 1.13)),
    snoise(q + vec3(1.7, 9.2, t * 0.87))
  );
  float f1 = snoise(q * 1.15 + w * (1.35 + 0.6 * uLevel) + vec3(0.0, t * 0.6, 0.0));
  float f2 = snoise(q * 2.05 - w * 0.85 + vec3(t * 0.4));
  vec3 col = mix(uC1, uC2, smoothstep(-0.65, 0.55, f1));
  col = mix(col, uC3, smoothstep(0.05, 0.85, f2) * 0.85);
  col = mix(col, uC4, smoothstep(0.3, 1.0, f1 * 0.6 + f2 * 0.6) * 0.7);

  // Glassy lighting: rim light, a soft highlight, shading towards the bottom.
  float fresnel = pow(1.0 - n.z, 2.4);
  col += fresnel * mix(uC3, vec3(1.0), 0.4) * 0.85;
  float spec = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 30.0);
  col += spec * 0.5;
  col *= 0.78 + 0.18 * n.z + 0.3 * uLevel;
  col *= mix(0.7, 1.0, smoothstep(-0.95, 0.35, n.y));

  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(grey), col, uSat);

  vec3 outside = glowColor * glow;
  gl_FragColor = vec4(col * inside + outside * (1.0 - inside), inside + glow * (1.0 - inside));
}
`

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export default function VoiceOrb({
  mode,
  levelRef,
  className = '',
}: {
  mode: OrbMode
  // The live audio level, 0–1, read every frame (no re-render per frame).
  levelRef: React.MutableRefObject<number>
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // A new canvas each time: a canvas keeps its context for life, so after
    // the cleanup below gives a context back, the same canvas could only
    // return a lost one (React runs effects twice in development).
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    host.appendChild(canvas)
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: 'low-power' })
    if (!gl) { canvas.remove(); setFallback(true); return }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
    }
    // Phones without high-precision fragment shaders get medium precision.
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
    const fragSrc = highp && highp.precision > 0 ? FRAGMENT : FRAGMENT.replace('precision highp float;', 'precision mediump float;')
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc)
    if (!vs || !fs) { canvas.remove(); setFallback(true); return }
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); setFallback(true); return }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const u = (name: string) => gl.getUniformLocation(prog, name)
    const uRes = u('uRes'), uTime = u('uTime'), uFlow = u('uFlow'), uLevel = u('uLevel'), uSat = u('uSat')
    const uColors = [u('uC1'), u('uC2'), u('uC3'), u('uC4')]

    // Sharp on retina screens, but capped so phones keep a smooth frame rate.
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = Math.min(Math.round(rect.width * dpr), 720)
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size
        canvas.height = size
        gl.viewport(0, 0, size, size)
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = ORB_PALETTES[modeRef.current]
    const colors = start.colors.map(hexToRgb)
    let speed = start.speed
    let saturation = start.saturation
    let flow = 0
    let level = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Ease into the current mode's colours and pace.
      const target = ORB_PALETTES[modeRef.current]
      const k = 1 - Math.exp(-dt * 2.6)
      target.colors.forEach((hex, i) => {
        const [r, g, b] = hexToRgb(hex)
        colors[i][0] += (r - colors[i][0]) * k
        colors[i][1] += (g - colors[i][1]) * k
        colors[i][2] += (b - colors[i][2]) * k
      })
      speed += (target.speed - speed) * k
      saturation += (target.saturation - saturation) * k
      level += ((levelRef.current || 0) - level) * (1 - Math.exp(-dt * 14))
      flow += dt * speed * (reduceMotion ? 0.25 : 1) * (1 + level * 0.8)

      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, reduceMotion ? 0 : now / 1000)
      gl.uniform1f(uFlow, flow)
      gl.uniform1f(uLevel, reduceMotion ? level * 0.4 : level)
      gl.uniform1f(uSat, saturation)
      colors.forEach((c, i) => gl.uniform3f(uColors[i], c[0], c[1], c[2]))
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // Nothing to draw while the tab is in the background.
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); setFallback(true) }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
      // Browsers allow only a handful of live WebGL contexts; give this one back
      // now rather than whenever it's garbage-collected.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [levelRef])

  if (fallback) return <FallbackOrb mode={mode} levelRef={levelRef} className={className} />
  return <div ref={hostRef} aria-hidden className={`aspect-square ${className}`} />
}

// Without WebGL: layered, blurred colour blobs turning inside a sphere, in the
// same palette, swelling with the audio level.
function FallbackOrb({ mode, levelRef, className }: { mode: OrbMode; levelRef: React.MutableRefObject<number>; className: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let raf = 0
    let level = 0
    const tick = () => {
      level += ((levelRef.current || 0) - level) * 0.2
      ref.current?.style.setProperty('--lvl', level.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [levelRef])
  const [c1, c2, c3, c4] = ORB_PALETTES[mode].colors
  return (
    <div ref={ref} aria-hidden className={`vo-fallback relative aspect-square ${className}`} style={{ ['--c1' as string]: c1, ['--c2' as string]: c2, ['--c3' as string]: c3, ['--c4' as string]: c4 }}>
      <style dangerouslySetInnerHTML={{ __html: fallbackStyles }} />
      <div className="vo-glow" />
      <div className="vo-sphere"><div className="vo-blob vo-b1" /><div className="vo-blob vo-b2" /><div className="vo-blob vo-b3" /><div className="vo-shine" /></div>
    </div>
  )
}

const fallbackStyles = `
.vo-fallback { --lvl: 0; }
.vo-glow { position:absolute; inset:6%; border-radius:9999px; background: radial-gradient(circle, color-mix(in srgb, var(--c3) 60%, transparent), transparent 65%); filter: blur(26px); opacity: calc(.45 + var(--lvl) * .5); transition: background 1s; }
.vo-sphere { position:absolute; inset:18%; border-radius:9999px; overflow:hidden; background: var(--c1); transform: scale(calc(1 + var(--lvl) * .1)); box-shadow: inset 0 0 40px rgba(255,255,255,.18), inset -14px -20px 50px rgba(0,0,0,.45); transition: background 1s; }
.vo-blob { position:absolute; width:80%; height:80%; border-radius:9999px; filter: blur(18px); mix-blend-mode: screen; transition: background 1s; }
.vo-b1 { background: var(--c2); left:-10%; top:-5%; animation: vo-orbit 7s linear infinite; }
.vo-b2 { background: var(--c3); right:-15%; top:20%; animation: vo-orbit 9s linear infinite reverse; }
.vo-b3 { background: var(--c4); left:10%; bottom:-20%; animation: vo-orbit 11s linear infinite; }
.vo-shine { position:absolute; left:20%; top:12%; width:34%; height:22%; border-radius:9999px; background: radial-gradient(closest-side, rgba(255,255,255,.55), transparent); filter: blur(5px); }
@keyframes vo-orbit { 0% { transform: rotate(0deg) translateX(10%) rotate(0deg); } 100% { transform: rotate(360deg) translateX(10%) rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) { .vo-blob { animation: none; } }
`
