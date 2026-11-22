// Moteur physique : un ressort par axe pour chaque module, une seule boucle requestAnimationFrame.
// React rend le contenu des modules ; ce moteur ne touche qu'à leur transform / opacité.

const KEYS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 's', 'o', 'open']
const K = { x: 120, y: 120, z: 140, rx: 160, ry: 160, rz: 120, s: 170, o: 90, open: 110 }
const DAMP = { x: 17, y: 17, z: 20, rx: 18, ry: 18, rz: 15, s: 21, o: 19, open: 20 }
const BASE_TILTS = [-16, 12, -8, 15, -13, 9, -18, 11, -6, 17, -12, 7]
const SAMPLES = 720

export function createEngine(stage, opts) {
  const bodies = new Map() // id -> body
  const pointer = { x: -9999, y: -9999, mx: 0.5, my: 0.5, inside: false, px: 0, py: 0, vx: 0, vy: 0 }
  let W = 0, H = 0, BW = 0, BH = 0, phone = false
  let ring = null
  let phase = 0, phaseV = 0
  let raf = 0, last = 0, t0 = performance.now() / 1000
  let drag = null // { body, ox, oy, sx, sy, moved }
  let spin = null // { x }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ---------- géométrie ---------- */
  function measure() {
    W = stage.clientWidth
    H = stage.clientHeight
    phone = W < 760
    BW = phone ? Math.min(W * 0.3, 140) : Math.max(130, Math.min(W * 0.128, 230))
    BH = BW * 1.327
    stage.style.setProperty('--bw', `${BW}px`)
    stage.style.setProperty('--bh', `${BH}px`)
    stage.style.setProperty('--bd', `${BW * 0.085}px`)
    buildRing()
  }

  // Super-ellipse (exposant .5 par axe = rectangle arrondi), paramétrée par longueur d'arc
  function buildRing() {
    const a = (phone ? 0.5 : 0.42) * W
    const b = (phone ? 0.42 : 0.43) * H
    const cx = W / 2, cy = 0.53 * H
    const pts = []
    const len = [0]
    for (let i = 0; i <= SAMPLES; i++) {
      const th = (i / SAMPLES) * Math.PI * 2
      const c = Math.cos(th), s = Math.sin(th)
      const x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), 0.5)
      const y = cy + b * Math.sign(s) * Math.pow(Math.abs(s), 0.5)
      if (i) len.push(len[i - 1] + Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]))
      pts.push([x, y])
    }
    ring = { pts, len, total: len[SAMPLES], cx, cy }
  }

  function ringAt(u) {
    u = ((u % 1) + 1) % 1
    const target = u * ring.total
    let lo = 0, hi = SAMPLES
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ring.len[mid] < target) lo = mid
      else hi = mid
    }
    const seg = ring.len[hi] - ring.len[lo] || 1
    const f = (target - ring.len[lo]) / seg
    const A = ring.pts[lo], B = ring.pts[hi]
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]
  }

  /* ---------- modules ---------- */
  function register(id, el, shadow) {
    if (bodies.has(id)) {
      const b = bodies.get(id)
      b.el = el
      b.shadow = shadow
      return
    }
    const i = bodies.size
    const p = { x: W / 2, y: H * 0.45, z: 0, rx: 0, ry: 0, rz: 0, s: 0.15, o: 0, open: 0 }
    const v = Object.fromEntries(KEYS.map((k) => [k, 0]))
    bodies.set(id, {
      id, i, el, shadow, p, v,
      b3d: el.querySelector('.b3d'),
      tilt: BASE_TILTS[i % BASE_TILTS.length],
      seed: Math.sin(i * 91.7) * 0.5 + 0.5,
      release: 0.25 + i * 0.07,
    })
  }
  function unregister(id) { bodies.delete(id) }

  /* ---------- cibles ---------- */
  function targets(b, st, t, order) {
    const T = { z: 0, rx: 0, ry: 0, rz: b.tilt, s: 1, o: 1, open: 0 }
    const { mx, my } = pointer
    const depth = 0.6 + b.seed * 0.8

    // intro : tout part du titre
    if (t - t0 < b.release && !reduce) {
      return { ...T, x: W / 2, y: H * 0.45, s: 0.15, o: 0, rz: 0 }
    }

    if (st.focus === b.id) {
      const s = phone ? Math.min(1.4, (0.34 * H) / BH) : Math.min(1.6, (0.56 * H) / BH)
      const x = phone ? W / 2 : Math.max((BW * s) / 2 + 30, 0.53 * W - (BW * s) / 2 - 24)
      const y = phone ? 0.34 * H : 0.5 * H
      const opened = t - st.focusAt > 0.65
      return {
        x: x + (mx - 0.5) * 10, y: y + (my - 0.5) * 8, z: 120,
        rx: (my - 0.5) * -6, ry: -12 + (mx - 0.5) * 10, rz: 0, s, o: 1,
        open: opened ? (st.readOpen ? 0.92 : 0.12) : 0,
      }
    }

    const active = st.active.has(b.id)
    if (!active) {
      return { ...T, x: b.p.x, y: H + 1.2 * BH, rz: b.tilt + (b.seed > 0.5 ? 60 : -60), o: 0, s: 0.9 }
    }

    if (st.focus) {
      const ang = Math.atan2(b.p.y - H / 2, b.p.x - W / 2)
      return { ...T, x: W / 2 + Math.cos(ang) * 0.62 * W * 1.1, y: H / 2 + Math.sin(ang) * 0.62 * H * 1.1, o: 0, s: 0.8 }
    }

    const k = order.indexOf(b.id)
    const n = order.length

    if (st.layout === 'grid') {
      const cols = Math.min(phone ? 3 : n > 12 ? 7 : 6, n)
      const rows = Math.ceil(n / cols)
      const gs = Math.min(0.78, (0.24 * H) / BH, (0.5 * H) / rows / (BH * 1.12))
      const cw = BW * gs * 1.2, ch = BH * gs * 1.12
      const cy = Math.max(0.66 * H, (phone ? 0.42 : 0.45) * H + (rows * ch) / 2)
      const row = Math.floor(k / cols), col = k % cols
      const inRow = row === rows - 1 ? n - row * cols : cols
      const x = W / 2 + (col - (inRow - 1) / 2) * cw + (mx - 0.5) * -10 * depth
      const y = cy + (row - (rows - 1) / 2) * ch + (my - 0.5) * -8 * depth
      const hov = st.hover === b.id && !drag
      return {
        x, y, z: hov ? 60 : 0, s: gs * (hov ? 1.07 : 1),
        rx: (my - 0.5) * -10, ry: (mx - 0.5) * 14, rz: hov ? 0 : b.tilt * 0.15, o: 1, open: hov ? 0.06 : 0,
      }
    }

    // orbite
    const u = phase / (Math.PI * 2) + k / n
    let [x, y] = ringAt(u)
    let s = 1
    const dx = Math.abs(x - W / 2)
    if (y < ring.cy && dx < 0.2 * W) {
      const f = 1 - dx / (0.2 * W)
      const e = f * f * (3 - 2 * f)
      y -= e * (0.17 * H + 0.35 * BH)
      s *= 1 - 0.25 * e
    }
    x += (mx - 0.5) * -38 * depth
    y += (my - 0.5) * -26 * depth + Math.sin(t * 0.7 + b.i * 1.7) * 5
    let rz = b.tilt + Math.sin(t * 0.5 + b.i) * 2.5

    if (pointer.inside && !drag) {
      const d = Math.hypot(x - pointer.x, y - pointer.y)
      const R = 1.25 * BW
      if (d < R && d > 0.001 && st.hover !== b.id) {
        const push = (1 - d / R) * 0.35 * BW
        x += ((x - pointer.x) / d) * push
        y += ((y - pointer.y) / d) * push
      }
    }
    const T2 = { x, y, z: 0, s, rx: (my - 0.5) * -16, ry: (mx - 0.5) * 22, rz, o: 1, open: 0 }
    if (st.hover === b.id && !drag) {
      T2.z = 70
      T2.s = s * 1.07
      T2.rz = rz * 0.45
      T2.open = 0.06
    }
    return T2
  }

  /* ---------- boucle ---------- */
  function frame(nowMs) {
    raf = requestAnimationFrame(frame)
    const now = nowMs / 1000
    const dt = Math.min(0.033, last ? now - last : 0.016)
    last = now
    const st = opts.getState()

    // vitesse du pointeur (px / image)
    pointer.vx = pointer.vx * 0.6 + (pointer.x - pointer.px) * 0.4
    pointer.vy = pointer.vy * 0.6 + (pointer.y - pointer.py) * 0.4
    pointer.px = pointer.x
    pointer.py = pointer.y

    if (!st.focus && st.layout === 'orbit' && !reduce) phase += 0.035 * dt
    phase += phaseV
    phaseV *= 0.93

    const order = [...bodies.values()].filter((b) => st.active.has(b.id)).sort((a, b) => a.i - b.i).map((b) => b.id)

    for (const b of bodies.values()) {
      const T = targets(b, st, now, order)
      if (drag && drag.body === b) {
        b.p.x = pointer.x - drag.ox
        b.p.y = pointer.y - drag.oy
        b.v.x = b.v.y = 0
        T.x = b.p.x
        T.y = b.p.y
        T.z = 110
        T.s = 1.1
        T.rz = b.tilt + pointer.vx * 2.2
        T.ry = pointer.vx * 3
        T.rx = -pointer.vy * 3
        T.o = 1
        T.open = 0
      }
      if (reduce) {
        for (const key of KEYS) { b.p[key] = T[key]; b.v[key] = 0 }
      } else {
        const h = dt / 4
        for (let step = 0; step < 4; step++) {
          for (const key of KEYS) {
            if (drag && drag.body === b && (key === 'x' || key === 'y')) continue
            const a = -K[key] * (b.p[key] - T[key]) - DAMP[key] * b.v[key]
            b.v[key] += a * h
            b.p[key] += b.v[key] * h
          }
        }
      }
      apply(b)
    }
  }

  function apply(b) {
    const { x, y, z, rx, ry, rz, s, o, open } = b.p
    b.el.style.transform =
      `translate3d(${x - BW / 2}px, ${y - BH / 2}px, ${z}px) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg) scale(${Math.max(0.01, s)})`
    b.el.style.opacity = Math.max(0, Math.min(1, o)).toFixed(3)
    b.el.style.zIndex = String(1000 + Math.round(z * 4))
    b.el.style.visibility = o < 0.01 ? 'hidden' : 'visible'
    if (b.b3d) {
      b.b3d.style.setProperty('--open', Math.max(0, Math.min(1, open)).toFixed(4))
      b.b3d.style.setProperty('--gx', `${(ry * 2.2).toFixed(1)}%`)
    }
    if (b.shadow) {
      const lift = Math.max(0, z)
      b.shadow.style.transform =
        `translate3d(${x - BW / 2 + lift * 0.15}px, ${y + BH * s * 0.38 + lift * 0.35}px, 0) scale(${s * (1 + lift / 400)}, ${s * 0.5})`
      b.shadow.style.opacity = (Math.max(0, Math.min(1, o)) * Math.max(0.15, 1 - lift / 220)).toFixed(3)
    }
  }

  /* ---------- interactions ---------- */
  function onMove(e) {
    const r = stage.getBoundingClientRect()
    pointer.x = e.clientX - r.left
    pointer.y = e.clientY - r.top
    pointer.mx = pointer.x / (W || 1)
    pointer.my = pointer.y / (H || 1)
    pointer.inside = true
    if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true
    if (spin) {
      phaseV += (e.clientX - spin.x) * 0.00012
      spin.x = e.clientX
    }
  }
  function onLeave() { pointer.inside = false; pointer.mx = 0.5; pointer.my = 0.5 }

  function grab(id, e) {
    const b = bodies.get(id)
    if (!b) return
    onMove(e)
    drag = { body: b, ox: pointer.x - b.p.x, oy: pointer.y - b.p.y, sx: e.clientX, sy: e.clientY, moved: false }
    pointer.px = pointer.x
    pointer.py = pointer.y
    pointer.vx = pointer.vy = 0
  }
  function startSpin(e) { spin = { x: e.clientX } }
  function onUp() {
    spin = null
    if (!drag) return null
    const { body, moved } = drag
    drag = null
    if (!moved) return { click: body.id }
    body.v.x = pointer.vx * 60
    body.v.y = pointer.vy * 60
    body.v.rz += pointer.vx * 8
    return { thrown: body.id }
  }
  function wheel(deltaY) { phaseV += deltaY * 0.00009 }

  function kick(strength = 1) {
    for (const b of bodies.values()) {
      b.v.rz += (Math.random() - 0.5) * 260 * strength
      b.v.z += (80 + Math.random() * 160) * strength
    }
  }
  function shuffle() {
    for (const b of bodies.values()) b.tilt = (Math.random() - 0.5) * 36
    phaseV += 0.04
    kick(1.4)
  }

  /* ---------- démarrage ---------- */
  const ro = new ResizeObserver(measure)
  measure()
  ro.observe(stage)
  raf = requestAnimationFrame(frame)
  t0 = performance.now() / 1000

  return {
    register, unregister, onMove, onLeave, grab, startSpin, onUp, wheel, kick, shuffle,
    isDragging: () => !!drag,
    destroy() { cancelAnimationFrame(raf); ro.disconnect() },
  }
}
