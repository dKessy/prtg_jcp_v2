// Capteur IPFIX : lecture et mise en forme des données renvoyées par /api/prtg/ipfix
import { DASHBOARD_URL, num } from './data.js'

export const IPFIX_URL = import.meta.env.VITE_IPFIX_URL || DASHBOARD_URL.replace(/\/dashboard$/, '/ipfix')
export const IPFIX_REFRESH_MS = 60000
export const RANGES = [
  { key: '10h', label: '10 heures' },
  { key: '2j', label: '2 jours' },
  { key: '30j', label: '30 jours' },
]

// palette de la charte (mêmes couleurs que les modules)
export const COLORS = ['#1d4fd6', '#f26b1d', '#1f4a3a', '#ec3d8c', '#c9b8ee', '#e0b400', '#8f8d88', '#5bb8a6', '#121212', '#a995d8', '#c9520f', '#7aa63c']
export const OTHER_COLOR = '#d8d2c3'

const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 })

export function formatBytes(b) {
  if (b == null || Number.isNaN(b)) return '–'
  if (b < 1024) return `${nf(0).format(b)} Octet`
  if (b < 1024 ** 2) return `${nf(0).format(b / 1024)} Ko`
  if (b < 1024 ** 3) return `${nf(1).format(b / 1024 ** 2)} Mo`
  return `${nf(2).format(b / 1024 ** 3)} Go`
}
export function formatKbit(k) {
  if (k == null || Number.isNaN(k)) return '–'
  if (k > 0 && k < 0.01) return '< 0,01 Kbit/s'
  if (k >= 1000) return `${nf(2).format(k / 1000)} Mbit/s`
  return `${nf(2).format(k)} Kbit/s`
}
export const pct = (p) => (p < 1 ? '< 1 %' : `${nf(0).format(p)} %`)

/* ---------------- canaux + historique ---------------- */
const SUFFIX = /\s*\((volume|speed|débit|debit|vitesse|vélocité)\)\s*$/i
const SPEED = /\((speed|débit|debit|vitesse|vélocité)\)\s*$/i
const VOLUME = /\(volume\)\s*$/i
const isTotal = (n) => /^total$/i.test(String(n).trim())

// "0,44 Kbit/s" -> 0.44 ; "1,2 Mbit/s" -> 1200
function kbitFromText(v) {
  const s = String(v || '').toLowerCase()
  const n = num(s)
  if (n == null) return null
  if (s.includes('mbit')) return n * 1000
  if (s.includes('gbit')) return n * 1e6
  if (s.includes('kbit')) return n
  if (s.includes('bit/s')) return n / 1000
  return null
}

/**
 * Transforme la réponse brute en séries prêtes à tracer (débit en Kbit/s).
 * Le facteur brut -> Kbit/s est calé sur le canal Total quand PRTG donne sa valeur affichée,
 * sinon on suppose des octets/s (×8/1000).
 */
export function buildTraffic(data) {
  const points = data?.history?.points || []
  const keys = new Set()
  points.forEach((p) => Object.keys(p.values || {}).forEach((k) => keys.add(k)))
  let speedKeys = [...keys].filter((k) => SPEED.test(k))
  if (!speedKeys.length) speedKeys = [...keys].filter((k) => !VOLUME.test(k))

  let factor = 8 / 1000
  const totalCh = (data?.channels || []).find((c) => isTotal(c.name))
  const shown = totalCh ? kbitFromText(totalCh.value) : null
  if (shown != null && totalCh.raw > 0) factor = shown / totalCh.raw

  const names = speedKeys.map((k) => k.replace(SUFFIX, ''))
  const series = names
    .map((name, i) => ({
      name,
      key: speedKeys[i],
      total: isTotal(name),
      values: points.map((p) => (p.values?.[speedKeys[i]] ?? 0) * factor),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  let ci = 0
  series.forEach((s) => { s.color = s.total ? '#141414' : COLORS[ci++ % COLORS.length] })

  // dernier créneau réellement mesuré : on saute les points de fin où tout vaut 0 (créneau en cours)
  let lastIdx = points.length - 1
  const sumAt = (i) => speedKeys.reduce((a, k) => a + (points[i].values?.[k] || 0), 0)
  while (lastIdx > 0 && sumAt(lastIdx) === 0) lastIdx--
  const last = (s) => (lastIdx >= 0 ? s.values[lastIdx] ?? null : null)
  const stats = Object.fromEntries(series.map((s) => [s.name, {
    last: last(s), min: s.values.length ? Math.min(...s.values) : null, max: s.values.length ? Math.max(...s.values) : null,
  }]))

  // canaux : on part de la liste PRTG et on complète avec les séries
  const chNames = new Set([...(data?.channels || []).map((c) => c.name), ...names])
  const channels = [...chNames].map((name) => {
    const c = (data?.channels || []).find((x) => x.name === name) || {}
    const s = series.find((x) => x.name === name)
    return { name, id: c.id, value: c.value, color: s?.color || OTHER_COLOR, total: isTotal(name), ...stats[name] }
  }).sort((a, b) => (a.total - b.total) || a.name.localeCompare(b.name, 'fr'))

  // volume (octets) par canal sur les ~15 dernières minutes mesurées, pour le repli du classement des protocoles
  const volKeys = [...keys].filter((k) => VOLUME.test(k))
  const avg = data?.history?.avg || 300
  const nLast = Math.max(1, Math.round(900 / avg))
  const recent = points.slice(Math.max(0, lastIdx + 1 - nLast), lastIdx + 1)
  const volumes = Object.fromEntries(volKeys.map((k) => [k.replace(SUFFIX, ''), recent.reduce((a, p) => a + (p.values?.[k] || 0), 0)]))

  return { times: points.map((p) => p.t), series, channels, volumes }
}

/* ---------------- classements (Top lists) ---------------- */
const VALUE_KEY = /(byte|octet|volume|traffic|trafic|size|taille)/i
const SRC_KEY = /(src|source|sender|exp(e|é)diteur|from)/i
const DST_KEY = /(dst|dest|destination|destinataire|receiver|to$)/i
const PORT_KEY = /port/i
const PROTO_KEY = /(proto|channel|canal|service|application|name|nom)/i
const SKIP_KEY = /^(pos|position|rank|percent|pourcent|%|id|objid|sort|name|channel|source|host|sum|size|lastvalue)$/i

/** Devine la colonne « volume » et les colonnes texte d'un classement, quels que soient les noms PRTG. */
export function analyzeToplist(rows, volumes) {
  if (!rows?.length) return null
  const keys = Object.keys(rows[0])
  const filled = (k) => rows.some((r) => r[k] !== '' && r[k] != null)
  const isNum = (k) => filled(k) && rows.every((r) => r[k] === '' || r[k] == null || !Number.isNaN(parseFloat(String(r[k]).replace(/\s/g, '').replace(',', '.'))))
  const rawOf = (k) => (keys.includes(`${k}_raw`) ? `${k}_raw` : k)

  let valueKey = keys.find((k) => /_raw$/.test(k) && VALUE_KEY.test(k) && isNum(k))
    || keys.find((k) => VALUE_KEY.test(k) && isNum(rawOf(k)) && rawOf(k))
  if (valueKey && !/_raw$/.test(valueKey) && keys.includes(`${valueKey}_raw`)) valueKey = `${valueKey}_raw`
  const valueBase = valueKey?.replace(/_raw$/, '')

  const textKeys = keys.filter((k) =>
    !/_raw$/.test(k) && k !== valueBase && k !== valueKey && !SKIP_KEY.test(k) && rows.some((r) => r[k]))
  const src = textKeys.find((k) => SRC_KEY.test(k) && !PORT_KEY.test(k))
  const dst = textKeys.find((k) => DST_KEY.test(k) && !PORT_KEY.test(k))
  const srcPort = textKeys.find((k) => SRC_KEY.test(k) && PORT_KEY.test(k))
  const dstPort = textKeys.find((k) => DST_KEY.test(k) && PORT_KEY.test(k))
  const proto = textKeys.find((k) => PROTO_KEY.test(k) && k !== src && k !== dst)

  const items = rows.map((r) => {
    const v = valueKey ? parseFloat(String(r[valueKey] ?? '').replace(/\s/g, '').replace(',', '.')) : NaN
    const label = (src && dst) ? `${r[src]} → ${r[dst]}` : (proto ? r[proto] : textKeys.map((k) => r[k]).filter(Boolean).join(' · '))
    const other = !label || /^(autre|other|others|autres)$/i.test(String(label).trim()) || /^(autre|other)/i.test(String(r.position || '')) || (src && !r[src] && !r[dst])
    return {
      label: other ? 'Autre' : label,
      other,
      src: src ? r[src] : null,
      dst: dst ? r[dst] : null,
      srcPort: srcPort ? r[srcPort] : null,
      dstPort: dstPort ? r[dstPort] : null,
      proto: proto && src ? r[proto] : null,
      value: Number.isNaN(v) ? 0 : v,
      display: valueBase && r[valueBase] && r[valueBase] !== r[valueKey] ? r[valueBase] : null,
    }
  })
  const kind = src && dst ? 'flows' : proto ? 'parts' : null
  if (!kind) return { kind: 'raw', keys, rows }
  let basis = 'bytes'
  if (!valueKey) {
    // PRTG ne fournit pas les octets via l'API : repli
    if (kind === 'parts' && volumes) {
      basis = 'channel-volume'
      items.forEach((it) => { it.value = it.other ? 0 : (volumes[it.label] || 0) })
      const known = items.reduce((a, b) => a + b.value, 0)
      if (!known) basis = 'none'
    } else {
      basis = kind === 'flows' ? 'count' : 'none'
      items.forEach((it) => { it.value = it.other ? 0 : 1 })
    }
  }
  const total = items.reduce((a, b) => a + b.value, 0)
  items.forEach((it) => { it.pct = total ? (it.value / total) * 100 : 0 })
  return { kind, items, total, basis, hasPorts: !!(srcPort || dstPort), hasProto: !!(proto && src) }
}

// "JCP-BROKER (172.16.86.11)" -> "JCP-BROKE…16.86.11)" comme dans PRTG
const IP_PROTO = { 1: 'ICMP', 6: 'TCP', 17: 'UDP', 47: 'GRE', 50: 'ESP', 51: 'AH', 58: 'ICMPv6', 132: 'SCTP' }
export const protoName = (p) => (p && IP_PROTO[+p] ? `${IP_PROTO[+p]} (${p})` : p || '')

export function shortHost(s, max = 20) {
  s = String(s || '')
  if (s.length <= max) return s
  const head = Math.ceil((max - 1) * 0.5)
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`
}

/* ---------------- démo ---------------- */
export function demoIpfix(range = '10h') {
  const now = Date.now()
  const conf = { '10h': [120, 300e3], '2j': [48, 3600e3], '30j': [120, 21600e3] }[range]
  const [n, step] = conf
  const chans = ['Autre', 'FTP/P2P', 'Infrastructure', 'Mail', 'NetBIOS', 'Remote Control', 'Various', 'WWW']
  const weight = { Autre: 0.25, 'FTP/P2P': 0.01, Infrastructure: 0.22, Mail: 0.05, NetBIOS: 0.02, 'Remote Control': 0.12, Various: 0.9, WWW: 1.4 }
  const points = []
  for (let i = 0; i < n; i++) {
    const t = now - (n - 1 - i) * step
    const d = new Date(t)
    const office = range === '30j' ? 1 : (d.getHours() >= 7 && d.getHours() <= 18 ? 1 : 0.25)
    const spike = Math.random() < 0.06 ? 3 + Math.random() * 4 : 1
    const values = {}
    let total = 0
    chans.forEach((c, k) => {
      const v = Math.max(0, weight[c] * office * spike * (0.35 + Math.abs(Math.sin(i * 0.21 + k)) * 0.9 + Math.random() * 0.4)) * 125 // octets/s
      values[`${c} (speed)`] = v
      values[`${c} (volume)`] = v * step / 1000
      total += v
    })
    values['Total (speed)'] = total
    values['Total (volume)'] = total * step / 1000
    points.push({ t: d.toLocaleString('fr-FR'), t_raw: t, values })
  }
  const lastTotal = points[points.length - 1].values['Total (speed)']
  const channels = [...chans, 'Total'].map((c, k) => ({
    id: c === 'Total' ? -1 : [0, 3002, 3007, 3003, 3008, 3005, 3009, 3001][k],
    name: c,
    value: c === 'Total' ? formatKbit(lastTotal * 8 / 1000) : formatBytes(points[points.length - 1].values[`${c} (volume)`]),
    raw: c === 'Total' ? lastTotal : null,
  }))

  const K = 1024
  const ip = [
    ['SRV-BROKER (10.10.86.11)', 'host-175-158-159-82.static.exemple.nc (175.158.159.82)', 1589],
    ['AD-01.jcp.local (127.0.0.1)', 'AD-01.jcp.local (127.0.0.1)', 732],
    ['SRV-RDS-02 (10.10.86.8)', 'ip-63-140-56-186.data.exemple.net (63.140.56.186)', 547],
    ['host-175-158-159-82.static.exemple.nc (175.158.159.82)', 'pare-feu-87.exemple.nc (202.87.1.87)', 377],
    ['[10.10.86.254]', 'AD-01.jcp.local (10.10.86.1)', 371],
    ['pare-feu-86.exemple.nc (202.87.1.86)', 'host-175-158-174-185.static.exemple.nc (175.158.174.185)', 357],
    ['SRV-RDS-02 (10.10.86.8)', 'ec2-98-95-175-102.compute-1.exemple.com (98.95.175.102)', 295],
    ['AD-01.jcp.local (10.10.86.1)', '[192.168.1.189]', 278],
    ['host-175-158-174-185.static.exemple.nc (175.158.174.185)', 'pare-feu-86.exemple.nc (202.87.1.86)', 242],
    ['', '', 188],
    ['[192.168.1.189]', 'AD-01.jcp.local (10.10.86.1)', 154],
    ['routeur-27.exemple.nc (202.87.1.27)', 'pare-feu-86.exemple.nc (202.87.1.86)', 74],
    ['pare-feu-86.exemple.nc (202.87.1.86)', 'routeur-27.exemple.nc (202.87.1.27)', 67],
    ['webmail.exemple.net (160.92.124.10)', 'pare-feu-86.exemple.nc (202.87.1.86)', 65],
  ]
  const conn = [
    ['SRV-BROKER (10.10.86.11)', '3391', 'host-175-158-159-82.static.exemple.nc (175.158.159.82)', '49271', '17', 1538],
    ['', '', '', '', '', 959],
    ['AD-01.jcp.local (127.0.0.1)', '8291', 'AD-01.jcp.local (127.0.0.1)', '43182', '6', 732],
    ['SRV-RDS-02 (10.10.86.8)', '64481', 'ip-63-140-56-186.data.exemple.net (63.140.56.186)', '443', '6', 547],
    ['[10.10.86.254]', '4739', 'AD-01.jcp.local (10.10.86.1)', '4739', '17', 367],
    ['pare-feu-86.exemple.nc (202.87.1.86)', '3391', 'host-175-158-174-185.static.exemple.nc (175.158.174.185)', '51022', '17', 352],
    ['SRV-RDS-02 (10.10.86.8)', '50114', 'ec2-98-95-175-102.compute-1.exemple.com (98.95.175.102)', '443', '6', 290],
    ['AD-01.jcp.local (10.10.86.1)', '53', '[192.168.1.189]', '61544', '17', 271],
    ['[192.168.1.189]', '61544', 'AD-01.jcp.local (10.10.86.1)', '53', '17', 150],
  ]
  const proto = [['Various', 3273], ['WWW', 2296], ['', 883], ['Infrastructure', 165], ['Mail', 39], ['Remote Control', 28], ['NetBIOS', 5166 / K]]
  return {
    id: 18676,
    demo: true,
    sensor: {
      sensor: 'IPFIX', device: 'MK VR (démo)', status: 'OK', status_raw: 3,
      lastcheck: 'il y a 8 min', interval: '5 min', message: 'OK',
    },
    channels,
    history: { range, points },
    toplists: [
      { subid: 1, title: 'Adresses IP les plus actives', rows: ip.map(([s, d, v], i) => ({ pos: s ? i + 1 : '', source: s, destination: d, bytes: formatBytes(v * K), bytes_raw: v * K })) },
      { subid: 2, title: 'Connexions les plus utilisées', rows: conn.map(([s, sp, d, dp, p, v], i) => ({ pos: s ? i + 1 : '', source: s, sourceport: sp, destination: d, destinationport: dp, protocol: p, bytes: formatBytes(v * K), bytes_raw: v * K })) },
      { subid: 3, title: 'Protocoles les plus utilisés', rows: proto.map(([c, v], i) => ({ pos: c ? i + 1 : '', channel: c, bytes: formatBytes(v * K), bytes_raw: v * K })) },
    ],
    errors: {},
  }
}
