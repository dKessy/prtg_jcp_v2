import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createEngine } from './engine.js'
import Ipfix from './Ipfix.jsx'
import {
  DASHBOARD_URL, REFRESH_MS, TONE_LABEL, demoItems, getGauge, normalize, palette,
  placeholderItems, plainText, sensorId, tone, visibleChannels,
} from './data.js'

const DEMO = new URLSearchParams(location.search).has('demo')
const THROW_TOASTS = ['Joli lancer.', 'Il revient toujours.', 'Gravité : en option.']
const PIN_KEY = 'prtg-jcp-pinned'

const readPinned = () => {
  try { return JSON.parse(localStorage.getItem(PIN_KEY)) || [] } catch { return [] }
}

/* ---------- petites pièces ---------- */
function Gauge({ value, max, caption }) {
  const R = 78
  const C = 2 * Math.PI * R
  const ratio = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <svg className="gauge" viewBox="0 0 200 200" role="img" aria-label={`${value} sur ${max} ${caption}`}>
      <circle className="gauge-track" cx="100" cy="100" r={R} />
      <circle className="gauge-value" cx="100" cy="100" r={R} strokeDasharray={`${C * ratio} ${C}`} transform="rotate(-90 100 100)" />
      <text x="100" y="112" textAnchor="middle" className="gauge-number">{value}</text>
      <text x="100" y="140" textAnchor="middle" className="gauge-caption">{caption}</text>
    </svg>
  )
}

function Highlight({ text, q }) {
  if (!q) return text
  const i = normalize(text).indexOf(normalize(q))
  if (i < 0) return text
  return (<>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>)
}

function Arrow() {
  return (<svg className="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>)
}

/* ---------- le module 3D (un capteur) ---------- */
function Module({ sensor, onRef, onGrab, onHover }) {
  const id = sensorId(sensor)
  const pal = palette(sensor.group)
  const t = tone(sensor.status_raw)
  const g = sensor.pending ? null : getGauge(sensor)
  const channels = visibleChannels(sensor)
  const msg = plainText(sensor.message)
  return (
    <div
      className={`mod tone-${t}`}
      data-id={id}
      ref={(el) => onRef(id, el)}
      onPointerDown={(e) => onGrab(id, e)}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
    >
      <div className="b3d" style={{ '--cover': pal.cover, '--spine': pal.spine, '--inside': pal.inside, '--fg': pal.fg }}>
        <div className="face front">
          <div className="cv">
            <div className="cv-top">
              <span>{sensor.group}</span>
              <i className="led" />
            </div>
            <h3 className="cv-title">{sensor.label}</h3>
            <div className="cv-mid">
              {g ? <Gauge value={g.value} max={g.max} caption={g.caption} />
                : <p className="cv-value">{sensor.pending ? '…' : sensor.value || '–'}</p>}
            </div>
            <div className="cv-foot">
              <span className={`badge badge-${t}`}>{sensor.pending ? 'En attente' : sensor.status}</span>
            </div>
            <div className="crease" />
            <div className="sheen" />
          </div>
          <div className="inside"><span>PRTG<br />JCP</span></div>
        </div>
        <div className="face page1">
          <p className="p-cat">{sensor.group} · {TONE_LABEL[t]}</p>
          <p className="p-title">{sensor.label}</p>
          {channels.length > 0 ? (
            <ul className="p-ch">
              {channels.slice(0, 6).map((c) => (<li key={c.name}><span>{c.name}</span><b>{c.value}</b></li>))}
            </ul>
          ) : (
            <p className="p-note">{msg || (sensor.pending ? 'En attente des données PRTG.' : `Valeur : ${sensor.value || '–'}`)}</p>
          )}
          <p className="p-dev">{sensor.device || '—'}</p>
        </div>
        <div className="face back" />
        <div className="face spine"><span>{sensor.label}</span></div>
        <div className="face edge-r" />
        <div className="face edge-t" />
        <div className="face edge-b" />
      </div>
    </div>
  )
}

/* ---------- module miniature dans le titre ---------- */
function MiniModule({ items, onShuffle }) {
  const [i, setI] = useState(0)
  const ref = useRef(null)
  useEffect(() => {
    if (!items.length) return undefined
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = setInterval(() => {
      const el = ref.current
      if (!el || reduce) { setI((n) => n + 1); return }
      const a = el.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], { duration: 260, easing: 'cubic-bezier(.5,0,1,.5)' })
      a.onfinish = () => {
        setI((n) => n + 1)
        el.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' })
      }
    }, 2600)
    return () => clearInterval(id)
  }, [items.length])
  const s = items.length ? items[i % items.length] : null
  const pal = palette(s?.group)
  const t = s ? tone(s.status_raw) : 'idle'
  return (
    <button type="button" className="mini" onClick={onShuffle} aria-label="Mélanger les capteurs" title="Mélanger">
      <span className="mini-tilt">
        <span ref={ref} className={`mini-b tone-${t}`} style={{ '--cover': pal.cover, '--spine': pal.spine, '--fg': pal.fg }}>
          <i className="led" />
          <span className="mini-l">{s ? s.label : ''}</span>
        </span>
      </span>
    </button>
  )
}

/* ---------- application ---------- */
export default function App() {
  const [items, setItems] = useState(() => (DEMO ? demoItems() : placeholderItems()))
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(DEMO ? Date.now() : null)
  const [now, setNow] = useState(Date.now())
  const [layout, setLayout] = useState('orbit')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(null)
  const [toneF, setToneF] = useState(null)
  const [focus, setFocus] = useState(null)
  const [readOpen, setReadOpen] = useState(true)
  const [hover, setHover] = useState(null)
  const [pinned, setPinned] = useState(readPinned)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [toast, setToast] = useState(null)
  const [bump, setBump] = useState(0)

  const stageRef = useRef(null)
  const engineRef = useRef(null)
  const elsRef = useRef(new Map())
  const shadowsRef = useRef(new Map())
  const tipRef = useRef(null)
  const searchRef = useRef(null)
  const shelfRef = useRef(null)
  const stateRef = useRef({ active: new Set(), focus: null, focusAt: 0, readOpen: true, layout: 'orbit', hover: null })
  const focusAtRef = useRef(0)
  const toastTimer = useRef(0)
  const heroRef = useRef(null)
  const heroVisible = useRef(true)

  /* ----- données ----- */
  const load = useCallback(async () => {
    if (DEMO) { setItems(demoItems()); setUpdatedAt(Date.now()); return }
    try {
      const res = await fetch(DASHBOARD_URL)
      let json
      try { json = await res.json() } catch { throw new Error(`réponse illisible du backend (HTTP ${res.status})`) }
      if (!res.ok || json.error || json.detail) throw new Error(json.error || json.detail || `Erreur HTTP ${res.status}`)
      setItems(json)
      setError(null)
      setUpdatedAt(Date.now())
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'backend injoignable' : e.message)
    }
  }, [])

  useEffect(() => {
    load()
    const refresh = setInterval(load, REFRESH_MS)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(refresh); clearInterval(clock) }
  }, [load])

  const say = useCallback((msg) => {
    setToast({ msg, k: Math.random() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  /* ----- dérivés ----- */
  const byId = useMemo(() => new Map(items.map((s) => [sensorId(s), s])), [items])
  const groups = useMemo(() => {
    const m = new Map()
    items.forEach((s) => m.set(s.group || 'Autres', (m.get(s.group || 'Autres') || 0) + 1))
    return [...m]
  }, [items])
  const found = items.filter((s) => s.found && !s.pending)
  const count = (n) => found.filter((s) => tone(s.status_raw) === n).length

  const matches = useCallback((s, q) => {
    if (!q) return true
    const n = normalize(q)
    return [s.label, s.device, s.group, s.status].some((f) => normalize(f).includes(n))
  }, [])

  const active = useMemo(() => new Set(items.filter((s) =>
    matches(s, query) && (!group || (s.group || 'Autres') === group) && (!toneF || tone(s.status_raw) === toneF),
  ).map(sensorId)), [items, query, group, toneF, matches])

  const results = useMemo(() => (query ? items.filter((s) => matches(s, query)).slice(0, 7) : []), [items, query, matches])
  const order = useMemo(() => items.map(sensorId).filter((id) => active.has(id)), [items, active])

  useLayoutEffect(() => {
    stateRef.current = { active, focus, focusAt: focusAtRef.current, readOpen, layout, hover, paused: !heroVisible.current }
  })

  /* ----- moteur ----- */
  useEffect(() => {
    const engine = createEngine(stageRef.current, { getState: () => stateRef.current })
    engineRef.current = engine
    for (const [id, el] of elsRef.current) engine.register(id, el, shadowsRef.current.get(id))
    return () => engine.destroy()
  }, [])

  const onRef = useCallback((id, el) => {
    if (el) {
      elsRef.current.set(id, el)
      engineRef.current?.register(id, el, shadowsRef.current.get(id))
    }
  }, [])
  // retire du moteur les capteurs qui ont disparu de la liste
  useEffect(() => {
    for (const id of [...elsRef.current.keys()]) {
      if (!byId.has(id)) { elsRef.current.delete(id); engineRef.current?.unregister(id) }
    }
  }, [byId])
  const onShadow = useCallback((id, el) => {
    if (el) shadowsRef.current.set(id, el); else shadowsRef.current.delete(id)
  }, [])

  const openFocus = useCallback((id) => {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' })
    focusAtRef.current = performance.now() / 1000
    setFocus(id)
    setReadOpen(true)
    setHover(null)
    setSearchOpen(false)
    setShelfOpen(false)
  }, [])
  const closeFocus = useCallback(() => setFocus(null), [])

  const step = useCallback((dir) => {
    if (!focus || !order.length) return
    const k = order.indexOf(focus)
    openFocus(order[(k + dir + order.length) % order.length])
  }, [focus, order, openFocus])

  const onGrab = useCallback((id, e) => {
    if (e.button !== 0 || focus) return
    e.stopPropagation()
    engineRef.current?.grab(id, e)
  }, [focus])

  /* ----- évènements globaux ----- */
  useEffect(() => {
    const move = (e) => {
      engineRef.current?.onMove(e)
      if (tipRef.current) tipRef.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`
    }
    const up = () => {
      const r = engineRef.current?.onUp()
      if (!r) return
      if (r.click) openFocus(r.click)
      if (r.thrown) say(THROW_TOASTS[Math.floor(Math.random() * THROW_TOASTS.length)])
    }
    const wheel = (e) => { if (!stateRef.current.focus && !stateRef.current.paused && stateRef.current.layout === 'orbit') engineRef.current?.wheel(e.deltaY) }
    const leave = () => engineRef.current?.onLeave()
    addEventListener('pointermove', move, { passive: true })
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    addEventListener('wheel', wheel, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      removeEventListener('wheel', wheel)
      document.documentElement.removeEventListener('pointerleave', leave)
    }
  }, [openFocus, say])

  useEffect(() => {
    const key = (e) => {
      const typing = e.target instanceof HTMLInputElement
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'Escape') {
        if (focus) closeFocus()
        setShelfOpen(false)
        setSearchOpen(false)
        if (typing) e.target.blur()
        return
      }
      if (focus && !typing && e.key === 'ArrowRight') step(1)
      if (focus && !typing && e.key === 'ArrowLeft') step(-1)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [focus, closeFocus, step])

  useEffect(() => {
    if (!shelfOpen) return undefined
    const close = (e) => { if (!shelfRef.current?.contains(e.target)) setShelfOpen(false) }
    addEventListener('pointerdown', close)
    return () => removeEventListener('pointerdown', close)
  }, [shelfOpen])

  useEffect(() => {
    document.documentElement.classList.toggle('lock', !!focus)
  }, [focus])

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      heroVisible.current = e.isIntersecting
      if (stateRef.current) stateRef.current.paused = !e.isIntersecting
    })
    io.observe(heroRef.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pinned)) } catch { /* stockage indisponible */ }
  }, [pinned])

  /* ----- actions ----- */
  const toggleLayout = () => {
    setLayout((l) => (l === 'orbit' ? 'grid' : 'orbit'))
    setFocus(null)
    engineRef.current?.kick(1)
  }
  const shuffle = () => { engineRef.current?.shuffle(); say('Capteurs mélangés') }

  const pin = (id) => {
    if (pinned.includes(id)) { setPinned(pinned.filter((p) => p !== id)); say('Retiré des épinglés'); return }
    const src = document.querySelector(`.mod[data-id="${CSS.escape(id)}"] .cv`)
    const dst = document.querySelector('.shelf-btn')
    setPinned([...pinned, id])
    if (!src || !dst || matchMedia('(prefers-reduced-motion: reduce)').matches) { setBump((b) => b + 1); return }
    const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect()
    const clone = src.cloneNode(true)
    clone.classList.add('fly')
    Object.assign(clone.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` })
    clone.style.setProperty('--cover', palette(byId.get(id)?.group).cover)
    clone.style.setProperty('--fg', palette(byId.get(id)?.group).fg)
    document.body.appendChild(clone)
    const dx = b.left + b.width / 2 - (a.left + a.width / 2)
    const dy = b.top + b.height / 2 - (a.top + a.height / 2)
    const anim = clone.animate([
      { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 160}px) rotate(-14deg) scale(.5)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(-30deg) scale(.08)`, opacity: 0.6 },
    ], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' })
    anim.onfinish = () => { clone.remove(); setBump((n) => n + 1) }
  }

  /* ----- rendu ----- */
  const secondes = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null
  const online = DEMO || (!error && updatedAt !== null)
  const fs = focus ? byId.get(focus) : null
  const ft = fs ? tone(fs.status_raw) : 'idle'
  const fg = fs && !fs.pending ? getGauge(fs) : null
  const hs = hover && !focus ? byId.get(hover) : null

  return (
    <div className={`app ${layout === 'grid' ? 'is-grid' : ''} ${focus ? 'is-focus' : ''}`}>
      <section className="hero-wrap" ref={heroRef}>
      {/* scène 3D */}
      <div
        id="stage"
        ref={stageRef}
        onPointerDown={(e) => {
          if (focus) { closeFocus(); return }
          engineRef.current?.startSpin(e)
        }}
      >
        <div className="shadows" aria-hidden="true">
          {items.map((s) => (<div key={sensorId(s)} className="shadow" ref={(el) => onShadow(sensorId(s), el)} />))}
        </div>
        {items.map((s) => (
          <Module key={sensorId(s)} sensor={s} onRef={onRef} onGrab={onGrab} onHover={setHover} />
        ))}
      </div>

      {/* barre du haut */}
      <header className="topbar">
        <p className="counter">{items.length} capteurs · {groups.length} groupes</p>
        <div className="brand">
          <a className="wordmark" href="./" aria-label="Moniteur PRTG JCP">PRTG<br />JCP</a>
          <div className={`search ${searchOpen && query ? 'open' : ''}`}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m14 14 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input
              ref={searchRef}
              value={query}
              placeholder={`Rechercher parmi ${items.length} capteurs`}
              aria-label="Rechercher un capteur"
              onChange={(e) => { setQuery(e.target.value); setSel(0); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(n + 1, results.length - 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(n - 1, 0)) }
                if (e.key === 'Enter' && results[sel]) { openFocus(sensorId(results[sel])); e.currentTarget.blur() }
              }}
            />
            {query ? <button type="button" className="clear" onClick={() => setQuery('')} aria-label="Effacer">×</button> : <kbd>/</kbd>}
            {searchOpen && query && (
              <ul className="results" role="listbox">
                {results.length === 0 && <li className="empty">Aucun capteur ne correspond…</li>}
                {results.map((s, i) => {
                  const p = palette(s.group)
                  return (
                    <li key={sensorId(s)} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''}
                      onPointerDown={(e) => { e.preventDefault(); openFocus(sensorId(s)) }} onPointerEnter={() => setSel(i)}>
                      <span className={`thumb tone-${tone(s.status_raw)}`} style={{ background: p.cover }}><i className="led" /></span>
                      <span className="r-txt"><b><Highlight text={s.label} q={query} /></b><small><Highlight text={`${s.group} · ${s.device || s.status}`} q={query} /></small></span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="top-right">
          <button type="button" className={`pill status ${DEMO ? 'demo' : online ? 'on' : 'off'}`} onClick={load} title="Actualiser">
            <span className="dot" />
            {DEMO ? 'Démo' : online ? 'En ligne' : 'Hors ligne'}
            <span className="ago">{secondes !== null ? `${secondes} s` : '—'}</span>
            <svg className="refresh" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="shelf" ref={shelfRef}>
            <button type="button" className="pill shelf-btn" onClick={() => setShelfOpen((o) => !o)} aria-expanded={shelfOpen}>
              Épinglés <span key={bump} className="shelf-n">{pinned.length}</span>
            </button>
            {shelfOpen && (
              <div className="shelf-drop">
                {pinned.length === 0 && <p className="empty">Épinglez un capteur depuis sa fiche pour le retrouver ici.</p>}
                {pinned.map((id) => {
                  const s = byId.get(id)
                  if (!s) return null
                  return (
                    <button type="button" key={id} className="shelf-item" onClick={() => openFocus(id)}>
                      <span className={`thumb tone-${tone(s.status_raw)}`} style={{ background: palette(s.group).cover }}><i className="led" /></span>
                      <span className="r-txt"><b>{s.label}</b><small>{s.group} · {s.pending ? 'En attente' : s.status}</small></span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* titre */}
      <section className="hero">
        <h1 className="headline">
          <span className="mask"><span className="ln">Tout le réseau JCP,</span></span>
          <span className="mask"><span className="ln ln2">d’un <MiniModule items={items} onShuffle={shuffle} /> coup d’œil.</span></span>
        </h1>
        <p className="sub">Les capteurs PRTG de JCP, mis à jour toutes les 30 secondes.</p>
        <div className="states" aria-label="Filtrer par état">
          {['ok', 'warn', 'down'].map((n) => (
            <button key={n} type="button" className={`state st-${n} ${toneF === n ? 'on' : ''}`} onClick={() => setToneF(toneF === n ? null : n)}>
              <i /> {count(n)} {n === 'ok' ? 'OK' : n === 'warn' ? 'avertissement' : 'en erreur'}
            </button>
          ))}
        </div>
        <button type="button" className="cta" onClick={toggleLayout}>
          {layout === 'orbit' ? 'Voir la grille' : 'Retour à l’orbite'} <Arrow />
        </button>
        <div className="chips">
          {groups.map(([name, n]) => (
            <button key={name} type="button" className={`chip ${group === name ? 'on' : ''}`} onClick={() => setGroup(group === name ? null : name)}>
              {name} <span>{n}</span>
            </button>
          ))}
        </div>
      </section>

      {/* coins */}
      <p className="hints">Glisser pour lancer · Molette pour tourner · Clic pour ouvrir</p>
      <div className="switch" role="group" aria-label="Disposition">
        <button type="button" className={layout === 'orbit' ? 'on' : ''} onClick={() => layout !== 'orbit' && toggleLayout()}>Orbite</button>
        <button type="button" className={layout === 'grid' ? 'on' : ''} onClick={() => layout !== 'grid' && toggleLayout()}>Grille</button>
      </div>
      {error && !focus && (
        <div className="alert" role="alert">
          <strong>Impossible de lire les capteurs :</strong> {error}. Lancez le backend sur le port 8000
          (token valide, sensors.json correct) — ou ouvrez la page avec <a href="?demo">?demo</a>.
        </div>
      )}
      <a className="scroll-hint" href="#ipfix">Trafic réseau (IPFIX) <span aria-hidden="true">↓</span></a>
      </section>

      <Ipfix demo={DEMO} />


      {/* infobulle */}
      <div ref={tipRef} className={`tip ${hs ? 'show' : ''}`} aria-hidden="true">
        {hs && (<><b>{hs.label}</b> <span>{hs.pending ? 'en attente' : hs.value || hs.status}</span></>)}
      </div>

      {/* fiche capteur */}
      {fs && (
        <>
          <button type="button" className="close" onClick={closeFocus} aria-label="Fermer">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          <aside className="panel" key={focus} aria-live="polite">
            <p className="pn-cat">{fs.group} · {fs.device || 'appareil inconnu'}</p>
            <h2 className="pn-title">{fs.label}</h2>
            <p className="pn-by">sur {fs.device || '—'}</p>
            <dl className="pn-meta">
              <div><dt>Statut</dt><dd><span className={`badge badge-${ft}`}>{fs.pending ? 'En attente' : fs.status}</span></dd></div>
              <div><dt>Valeur</dt><dd>{fg ? `${fg.value} ${fg.caption}` : fs.value || '–'}</dd></div>
              <div><dt>Canaux</dt><dd>{visibleChannels(fs).length}</dd></div>
            </dl>
            <p className="pn-note">
              {fs.pending ? 'Les valeurs apparaîtront dès que le backend répondra.'
                : fs.found ? (fg?.note ? `${fg.note}. ` : '') + (plainText(fs.message) || 'Aucun message PRTG.')
                  : 'Capteur introuvable : vérifiez l’ID dans sensors.json.'}
            </p>
            {visibleChannels(fs).length > 0 && (
              <ul className="pn-ch">
                {visibleChannels(fs).map((c) => (<li key={c.name}><span>{c.name}</span><b>{c.value}</b></li>))}
              </ul>
            )}
            <div className="pn-btns">
              <button type="button" className="btn-dark" onClick={() => setReadOpen((o) => !o)}>
                {readOpen ? 'Refermer le module' : 'Voir les canaux'}
              </button>
              <button type="button" className={`btn-line ${pinned.includes(focus) ? 'done' : ''}`} onClick={() => pin(focus)}>
                {pinned.includes(focus) ? 'Épinglé ✓' : 'Épingler'}
              </button>
            </div>
          </aside>
          <div className="nav-arrows">
            <button type="button" onClick={() => step(-1)} aria-label="Capteur précédent">←</button>
            <span>{order.indexOf(focus) + 1} / {order.length}</span>
            <button type="button" onClick={() => step(1)} aria-label="Capteur suivant">→</button>
          </div>
        </>
      )}

      {toast && <div className="toast" key={toast.k} role="status">{toast.msg}</div>}
    </div>
  )
}
