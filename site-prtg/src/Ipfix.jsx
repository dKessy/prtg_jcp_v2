import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ipfix.css'
import { tone } from './data.js'
import {
  COLORS, IPFIX_REFRESH_MS, IPFIX_URL, OTHER_COLOR, RANGES, analyzeToplist, buildTraffic,
  demoIpfix, formatBytes, formatKbit, pct, shortHost,
} from './ipfix.js'

const TAU = Math.PI * 2
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)]

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/* ---------------- jauge (style PRTG, charte papier) ---------------- */
function Gauge({ value, max, label, big, color = '#141414' }) {
  const start = -135 * (Math.PI / 180)
  const sweep = 270 * (Math.PI / 180)
  const r = 40
  const ratio = max > 0 ? Math.min(1, (value || 0) / max) : 0
  const arc = (a0, a1) => {
    const [x0, y0] = polar(50, 52, r, a0)
    const [x1, y1] = polar(50, 52, r, a1)
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
  }
  const [nx, ny] = polar(50, 52, r - 12, start + sweep * ratio)
  return (
    <figure className={`gauge-card ${big ? 'big' : ''}`}>
      <figcaption>{label}</figcaption>
      <svg viewBox="0 0 100 92" role="img" aria-label={`${label} : ${formatKbit(value)}`}>
        <path d={arc(start, start + sweep)} className="g-track" />
        {ratio > 0.002 && <path d={arc(start, start + sweep * ratio)} className="g-val" style={{ stroke: color }} />}
        <line x1="50" y1="52" x2={nx} y2={ny} className="g-needle" />
        <circle cx="50" cy="52" r="3.4" className="g-hub" />
      </svg>
      <p className="g-num">{formatKbit(value)}</p>
      {big && <p className="g-range"><span>0 Kbit/s</span><span>{formatKbit(max)}</span></p>}
    </figure>
  )
}

/* ---------------- anneau (protocoles) ---------------- */
function Donut({ items, hover, setHover }) {
  const size = 320, cx = 160, cy = 160, R = 120, r = 46
  let a = 0
  const segs = items.filter((it) => it.value > 0).map((it, i) => {
    const a0 = a
    a += (it.value / items.reduce((s, x) => s + x.value, 0)) * TAU
    return { ...it, a0, a1: a, color: it.other ? OTHER_COLOR : COLORS[i % COLORS.length] }
  })
  const path = (a0, a1, ro, ri) => {
    if (a1 - a0 >= TAU - 1e-6) a1 = a0 + TAU - 1e-4
    const large = a1 - a0 > Math.PI ? 1 : 0
    const [x0, y0] = polar(cx, cy, ro, a0), [x1, y1] = polar(cx, cy, ro, a1)
    const [x2, y2] = polar(cx, cy, ri, a1), [x3, y3] = polar(cx, cy, ri, a0)
    return `M${x0} ${y0}A${ro} ${ro} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`
  }
  return (
    <svg className="donut" viewBox={`-70 -10 ${size + 140} ${size + 20}`} role="img" aria-label="Répartition par protocole">
      {segs.map((s, i) => {
        const mid = (s.a0 + s.a1) / 2
        const on = hover === i
        const [ox, oy] = polar(0, 0, on ? 8 : 0, mid)
        const [tx, ty] = polar(cx, cy, (R + r) / 2, mid)
        const [lx, ly] = polar(cx, cy, R + 18, mid)
        const right = Math.sin(mid) >= 0
        return (
          <g key={i} transform={`translate(${ox} ${oy})`} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
            className={hover != null && !on ? 'dim' : ''}>
            <path d={path(s.a0, s.a1, R, r)} fill={s.color} className="seg" />
            {s.a1 - s.a0 > 0.28 && <text x={tx} y={ty} className="seg-pct" textAnchor="middle" dominantBaseline="middle" fill={s.color === OTHER_COLOR || s.color === '#c9b8ee' || s.color === '#e0b400' ? '#141414' : '#fff'}>{pct(s.pct)}</text>}
            {(s.a1 - s.a0 > 0.12 || on) && <text x={lx} y={ly} className="seg-lab" textAnchor={right ? 'start' : 'end'} dominantBaseline="middle">{s.label}</text>}
          </g>
        )
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" className="donut-c">{hover != null && segs[hover] ? pct(segs[hover].pct) : segs.length}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="donut-s">{hover != null && segs[hover] ? segs[hover].label : 'protocoles'}</text>
    </svg>
  )
}

/* ---------------- diagramme de flux (adresses / connexions) ---------------- */
function Chord({ items, hover, setHover }) {
  const W = 460, cx = 230, cy = 230, R = 150, band = 16
  const { nodes, ribbons } = useMemo(() => {
    const flows = items.filter((it) => !it.other && it.value > 0)
    const totals = new Map()
    flows.forEach((f) => {
      totals.set(f.src, (totals.get(f.src) || 0) + f.value)
      totals.set(f.dst, (totals.get(f.dst) || 0) + f.value)
    })
    const ranked = [...totals].sort((a, b) => b[1] - a[1])
    const keep = new Set(ranked.slice(0, 11).map(([k]) => k))
    const key = (h) => (keep.has(h) ? h : 'Autre')
    const merged = new Map()
    flows.forEach((f) => { const k = key(f.src); const d = key(f.dst); merged.set(k, (merged.get(k) || 0)); merged.set(d, (merged.get(d) || 0)) })
    flows.forEach((f) => { merged.set(key(f.src), merged.get(key(f.src)) + f.value); merged.set(key(f.dst), merged.get(key(f.dst)) + f.value) })
    const list = [...merged].sort((a, b) => (a[0] === 'Autre') - (b[0] === 'Autre') || b[1] - a[1])
    const sum = list.reduce((s, [, v]) => s + v, 0) || 1
    const gap = 0.025
    const usable = TAU - gap * list.length
    let a = 0
    const ns = list.map(([name, v], i) => {
      const a0 = a
      a += (v / sum) * usable
      const n = { name, value: v, a0, a1: a, cursor: a0, color: name === 'Autre' ? OTHER_COLOR : COLORS[i % COLORS.length] }
      a += gap
      return n
    })
    const byName = new Map(ns.map((n) => [n.name, n]))
    const rs = flows.map((f, i) => {
      const s = byName.get(key(f.src)), d = byName.get(key(f.dst))
      const span = (n) => (f.value / n.value) * (n.a1 - n.a0)
      const s0 = s.cursor; s.cursor += span(s)
      const d0 = d.cursor; d.cursor += span(d)
      return { i, s, d, s0, s1: s0 + span(s), d0, d1: d0 + span(d), f }
    })
    return { nodes: ns, ribbons: rs }
  }, [items])

  const rib = (r) => {
    const ri = R - 2
    const p = (a) => polar(cx, cy, ri, a)
    const [a, b, c, d] = [p(r.s0), p(r.s1), p(r.d0), p(r.d1)]
    return `M${a[0]} ${a[1]}A${ri} ${ri} 0 0 1 ${b[0]} ${b[1]}Q${cx} ${cy} ${c[0]} ${c[1]}A${ri} ${ri} 0 0 1 ${d[0]} ${d[1]}Q${cx} ${cy} ${a[0]} ${a[1]}Z`
  }
  const arc = (n) => {
    const [x0, y0] = polar(cx, cy, R + band, n.a0), [x1, y1] = polar(cx, cy, R + band, n.a1)
    const [x2, y2] = polar(cx, cy, R, n.a1), [x3, y3] = polar(cx, cy, R, n.a0)
    const large = n.a1 - n.a0 > Math.PI ? 1 : 0
    return `M${x0} ${y0}A${R + band} ${R + band} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${R} ${R} 0 ${large} 0 ${x3} ${y3}Z`
  }
  const active = (r) => hover == null || r.s.name === hover || r.d.name === hover

  return (
    <svg className="chord" viewBox={`-120 -40 ${W + 240} ${W + 80}`} role="img" aria-label="Échanges entre adresses">
      <g className="ribbons">
        {ribbons.map((r) => (
          <path key={r.i} d={rib(r)} fill={r.s.color} className={active(r) ? 'on' : 'off'}>
            <title>{`${r.f.src} → ${r.f.dst} : ${r.f.display || formatBytes(r.f.value)}`}</title>
          </path>
        ))}
      </g>
      {nodes.map((n) => {
        const mid = (n.a0 + n.a1) / 2
        const [lx, ly] = polar(cx, cy, R + band + 10, mid)
        const [tx, ty] = polar(cx, cy, R + band / 2, mid)
        const right = Math.sin(mid) >= 0
        const share = Math.round((n.value / nodes.reduce((s, x) => s + x.value, 0)) * 100)
        return (
          <g key={n.name} onPointerEnter={() => setHover(n.name)} onPointerLeave={() => setHover(null)} className={`node ${hover && hover !== n.name ? 'dim' : ''}`}>
            <path d={arc(n)} fill={n.color} />
            {n.a1 - n.a0 > 0.14 && <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="node-n" fill={n.color === OTHER_COLOR ? '#141414' : '#fff'}>{share}</text>}
            {(n.a1 - n.a0 > 0.07 || hover === n.name) && (
              <text x={lx} y={ly} textAnchor={right ? 'start' : 'end'} dominantBaseline="middle" className="node-l">{shortHost(n.name, 22)}</text>
            )}
            <title>{`${n.name} : ${formatBytes(n.value)}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

/* ---------------- historique (aires empilées) ---------------- */
function History({ traffic, range }) {
  const [ref, w] = useWidth()
  const [hidden, setHidden] = useState(() => new Set())
  const [hx, setHx] = useState(null)
  const H = 280, pad = { l: 52, r: 16, t: 14, b: 30 }
  const series = traffic.series.filter((s) => !s.total && !hidden.has(s.name))
  const totalS = traffic.series.find((s) => s.total)
  const n = traffic.times.length
  const stacks = useMemo(() => {
    const acc = new Array(n).fill(0)
    return series.map((s) => {
      const lo = acc.slice()
      s.values.forEach((v, i) => { acc[i] += v || 0 })
      return { s, lo, hi: acc.slice() }
    })
  }, [series, n])
  const maxY = Math.max(0.01, ...(stacks.length ? stacks[stacks.length - 1].hi : [0]), ...(totalS && !hidden.has('Total') ? totalS.values : [0])) * 1.08
  const iw = Math.max(10, w - pad.l - pad.r), ih = H - pad.t - pad.b
  const X = (i) => pad.l + (n > 1 ? (i / (n - 1)) * iw : 0)
  const Y = (v) => pad.t + ih - (v / maxY) * ih
  const area = ({ lo, hi }) => {
    if (!n) return ''
    let d = `M${X(0)} ${Y(hi[0])}`
    for (let i = 1; i < n; i++) d += `L${X(i)} ${Y(hi[i])}`
    for (let i = n - 1; i >= 0; i--) d += `L${X(i)} ${Y(lo[i])}`
    return `${d}Z`
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY / 1.08)
  const xt = n > 1 ? [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (n - 1))) : []
  const fmtT = (t) => {
    const m = String(t || '').match(/(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}\s+(\d{1,2}):(\d{2})/)
    if (!m) return String(t || '').slice(0, 16)
    return range === '10h' ? `${m[3].padStart(2, '0')}:${m[4]}` : `${m[1]}/${m[2]}${range === '2j' ? ` ${m[3]}h` : ''}`
  }

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (n - 1))
    setHx(i >= 0 && i < n ? i : null)
  }
  const toggle = (name) => setHidden((h) => { const s = new Set(h); if (s.has(name)) s.delete(name); else s.add(name); return s })

  return (
    <div className="history">
      <div className="legend">
        {traffic.series.map((s) => (
          <button key={s.name} type="button" className={`lg ${hidden.has(s.name) ? 'off' : ''}`} onClick={() => toggle(s.name)}>
            <i style={{ background: s.color }} /> {s.name}
          </button>
        ))}
      </div>
      <div className="plot" ref={ref}>
        {w > 0 && n > 0 && (
          <svg width={w} height={H} onPointerMove={onMove} onPointerLeave={() => setHx(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} className="grid" />
                <text x={pad.l - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" className="ax">{t >= 1000 ? `${(t / 1000).toFixed(1)} M` : t.toFixed(t < 10 ? 1 : 0)}</text>
              </g>
            ))}
            <text x={12} y={pad.t + ih / 2} className="ax" transform={`rotate(-90 12 ${pad.t + ih / 2})`} textAnchor="middle">Kbit/s</text>
            {xt.map((i) => (<text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="ax">{fmtT(traffic.times[i])}</text>))}
            {stacks.map((st) => (<path key={st.s.name} d={area(st)} fill={st.s.color} className="area" />))}
            {totalS && !hidden.has('Total') && (
              <path d={totalS.values.map((v, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(v)}`).join('')} className="total-line" />
            )}
            {hx != null && <line x1={X(hx)} x2={X(hx)} y1={pad.t} y2={pad.t + ih} className="cross" />}
          </svg>
        )}
        {hx != null && (
          <div className="h-tip" style={{ left: Math.min(Math.max(X(hx) + 12, 0), Math.max(0, w - 220)) }}>
            <b>{traffic.times[hx]}</b>
            {traffic.series.filter((s) => !hidden.has(s.name)).map((s) => (
              <span key={s.name}><i style={{ background: s.color }} />{s.name}<em>{formatKbit(s.values[hx])}</em></span>
            ))}
          </div>
        )}
        {n === 0 && <p className="empty">Pas d’historique pour cette période.</p>}
      </div>
    </div>
  )
}

/* ---------------- fenêtre de classement ---------------- */
function TopWindow({ top, period, big, onToggle }) {
  const [hover, setHover] = useState(null)
  const a = useMemo(() => analyzeToplist(top.rows), [top.rows])
  const [all, setAll] = useState(false)
  const rows = a ? (all ? a.items : a.items.slice(0, 10)) : []
  return (
    <article className={`win ${big ? 'big' : ''}`}>
      <header className="win-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <div className="win-t">
          <h3>{top.title}</h3>
          <p>{period}</p>
        </div>
        <button type="button" className="win-btn" onClick={onToggle} aria-label={big ? 'Réduire la fenêtre' : 'Agrandir la fenêtre'}>
          {big
            ? <svg viewBox="0 0 16 16"><path d="M6 2v4H2M10 14v-4h4M14 6h-4V2M2 10h4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 10v4h-4M10 2h4v4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
      </header>
      {top.error && <p className="win-err">Classement indisponible : {top.error}</p>}
      {!top.error && !a && <p className="win-err">Aucune donnée pour le moment.</p>}
      {a?.kind === 'raw' && (
        <div className="win-table raw">
          <p className="win-err">Format de classement non reconnu : voici les données brutes renvoyées par PRTG.</p>
          <table>
            <thead><tr>{a.keys.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{a.rows.slice(0, 15).map((r, i) => <tr key={i}>{a.keys.map((k) => <td key={k}>{String(r[k] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {a && a.kind !== 'raw' && (
        <div className="win-body">
          <div className="win-chart">
            {a.kind === 'flows' ? <Chord items={a.items} hover={hover} setHover={setHover} /> : <Donut items={a.items} hover={hover} setHover={setHover} />}
          </div>
          <div className="win-table">
            <table>
              <thead>
                <tr>
                  <th>Pos.</th>
                  {a.kind === 'flows' ? (<><th>Expéditeur</th>{a.hasPorts && big && <th>Port</th>}<th>Destinataire</th>{a.hasPorts && big && <th>Port</th>}{a.hasProto && big && <th>Proto.</th>}</>) : <th>Canal</th>}
                  <th className="num">Octets</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it, i) => {
                  const pos = a.items.slice(0, a.items.indexOf(it)).filter((x) => !x.other).length + 1
                  return (
                    <tr key={i} className={it.other ? 'other' : ''}>
                      <td>{it.other ? 'Autre' : pos}</td>
                      {a.kind === 'flows' ? (
                        <>
                          <td title={it.src}>{it.other ? '' : shortHost(it.src, big ? 34 : 26)}</td>
                          {a.hasPorts && big && <td>{it.srcPort}</td>}
                          <td title={it.dst}>{it.other ? '' : shortHost(it.dst, big ? 34 : 26)}</td>
                          {a.hasPorts && big && <td>{it.dstPort}</td>}
                          {a.hasProto && big && <td>{it.proto}</td>}
                        </>
                      ) : (
                        <td><i className="sw" style={{ background: it.other ? OTHER_COLOR : COLORS[a.items.filter((x) => x.value > 0).indexOf(it) % COLORS.length] }} />{it.other ? '' : it.label}</td>
                      )}
                      <td className="num">{it.display || formatBytes(it.value)}</td>
                      <td className="num">{pct(it.pct)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {a.items.length > 10 && (
              <button type="button" className="more" onClick={() => setAll((x) => !x)}>
                {all ? 'Voir moins' : `Voir les ${a.items.length} lignes`}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

/* ---------------- section IPFIX ---------------- */
export default function Ipfix({ demo }) {
  const [range, setRange] = useState('10h')
  const [data, setData] = useState(() => (demo ? demoIpfix('10h') : null))
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!demo)
  const [big, setBig] = useState(null)

  const load = useCallback(async (rng) => {
    if (demo) { setData(demoIpfix(rng)); return }
    setLoading(true)
    try {
      const res = await fetch(`${IPFIX_URL}?range=${rng}`)
      let json
      try { json = await res.json() } catch { throw new Error(`réponse illisible du backend (HTTP ${res.status})`) }
      if (!res.ok || json.detail) throw new Error(json.detail || `Erreur HTTP ${res.status}`)
      setData(json)
      setError(null)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'backend injoignable' : e.message)
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    load(range)
    const id = setInterval(() => load(range), IPFIX_REFRESH_MS)
    return () => clearInterval(id)
  }, [load, range])

  const traffic = useMemo(() => buildTraffic(data), [data])
  const total = traffic.channels.find((c) => c.total)
  const others = traffic.channels.filter((c) => !c.total)
  const s = data?.sensor
  const t = s ? tone(s.status_raw) : 'idle'
  const period = useMemo(() => {
    const d = new Date()
    const q = Math.floor(d.getMinutes() / 15) * 15
    const a = new Date(d); a.setMinutes(q, 0, 0)
    const b = new Date(a.getTime() + 15 * 60e3)
    const f = (x) => x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    return `${a.toLocaleDateString('fr-FR')} · ${f(a)} – ${f(b)} · classement en cours`
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const partErrors = Object.entries(data?.errors || {})

  return (
    <section className="ipfix" id="ipfix" aria-labelledby="ipfix-title">
      <header className="ip-head">
        <div>
          <p className="ip-kicker">Capteur IPFIX · #{data?.id ?? '—'}{data?.demo ? ' · démo' : ''}</p>
          <h2 id="ipfix-title">Ce qui passe sur le réseau,<br />protocole par protocole.</h2>
          <p className="ip-sub">
            {s ? <>{s.device} · dernière analyse {s.lastcheck ? String(s.lastcheck).replace(/<[^>]*>/g, '') : '—'} · intervalle {s.interval || '—'}</> : 'Trafic analysé par le capteur IPFIX de PRTG.'}
          </p>
        </div>
        <div className="ip-actions">
          {s && <span className={`badge badge-${t}`}>{s.status}</span>}
          <div className="seg" role="group" aria-label="Période">
            {RANGES.map((r) => (
              <button key={r.key} type="button" className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>{r.label}</button>
            ))}
          </div>
          <button type="button" className={`ip-refresh ${loading ? 'spin' : ''}`} onClick={() => load(range)} aria-label="Actualiser le capteur IPFIX">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </header>

      {error && (
        <div className="ip-alert" role="alert">
          <strong>Impossible de lire le capteur IPFIX :</strong> {error}. Vérifiez le backend et <code>IPFIX_SENSOR_ID</code> dans <code>.env</code> — ou ouvrez la page avec <a href="?demo">?demo</a>.
        </div>
      )}
      {!error && partErrors.length > 0 && (
        <div className="ip-alert soft" role="status">
          Certaines parties sont indisponibles : {partErrors.map(([k, v]) => `${{ sensor: 'infos capteur', channels: 'canaux', history: 'historique' }[k] || k} (${v})`).join(' · ')}
        </div>
      )}

      {/* jauges */}
      <div className="win gauges-win">
        <header className="win-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <div className="win-t"><h3>Débit actuel</h3><p>par canal · dernière valeur</p></div>
        </header>
        <div className="gauges">
          <Gauge big label="Total" value={total?.last} max={total?.max} />
          <div className="gauges-small">
            {others.map((c) => (<Gauge key={c.name} label={c.name} value={c.last} max={c.max} color={c.color} />))}
          </div>
        </div>
      </div>

      {/* historique */}
      <div className="win">
        <header className="win-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <div className="win-t"><h3>Graphique · {RANGES.find((r) => r.key === range).label}</h3><p>débit par canal, empilé · cliquez la légende pour masquer un canal</p></div>
        </header>
        <History traffic={traffic} range={range} />
      </div>

      {/* classements */}
      <div className="wins">
        {(data?.toplists || []).map((top) => (
          <TopWindow key={top.subid} top={top} period={period} big={big === top.subid} onToggle={() => setBig(big === top.subid ? null : top.subid)} />
        ))}
      </div>

      {/* canaux */}
      <div className="win">
        <header className="win-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <div className="win-t"><h3>Canaux</h3><p>minimum et maximum calculés sur la période affichée</p></div>
        </header>
        <div className="ch-table">
          <table>
            <thead>
              <tr><th>Canal</th><th className="num">ID</th><th className="num">Dernière valeur</th><th className="num">Débit</th><th className="num">Minimum</th><th className="num">Maximum</th></tr>
            </thead>
            <tbody>
              {traffic.channels.map((c) => (
                <tr key={c.name} className={c.total ? 'total' : ''}>
                  <td><i className="sw" style={{ background: c.color }} />{c.name}</td>
                  <td className="num">{c.id ?? '–'}</td>
                  <td className="num">{c.value || '–'}</td>
                  <td className="num">{formatKbit(c.last)}</td>
                  <td className="num">{formatKbit(c.min)}</td>
                  <td className="num">{formatKbit(c.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="ip-foot">Moniteur PRTG JCP · données IPFIX rafraîchies toutes les 60 s</p>
    </section>
  )
}
