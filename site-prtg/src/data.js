import sensorsConfig from '../../backup/sensors.json'

export const DASHBOARD_URL =
  import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:8000/api/prtg/dashboard'
export const REFRESH_MS = 30000 // à aligner sur l'intervalle de scan des capteurs dans PRTG
export const HIDDEN_CHANNELS = ['downtime', 'temps mort']

// Couleurs par groupe : façade / tranche / intérieur / texte sur la façade
const PALETTES = {
  'RDS 1': { cover: '#1d4fd6', spine: '#153ba3', inside: '#f4f1ea', fg: '#ffffff' },
  'RDS 2': { cover: '#1f4a3a', spine: '#163629', inside: '#efe6d4', fg: '#efe6d4' },
  'Routeurs MikroTik': { cover: '#f26b1d', spine: '#c9520f', inside: '#141414', fg: '#141414' },
}
const EXTRA = [
  { cover: '#ecebe6', spine: '#cfccc4', inside: '#1a1a1a', fg: '#141414' },
  { cover: '#c9b8ee', spine: '#a995d8', inside: '#f7d23e', fg: '#141414' },
  { cover: '#121212', spine: '#000000', inside: '#d7ff3a', fg: '#f4f1ea' },
  { cover: '#f5e72d', spine: '#d6c61b', inside: '#141414', fg: '#141414' },
  { cover: '#ec3d8c', spine: '#bf2a6c', inside: '#ffe066', fg: '#ffffff' },
]
const extraByGroup = new Map()
export function palette(group) {
  if (PALETTES[group]) return PALETTES[group]
  if (!extraByGroup.has(group)) extraByGroup.set(group, EXTRA[extraByGroup.size % EXTRA.length])
  return extraByGroup.get(group)
}

export const sensorId = (s) => `${s.group || 'Autres'}|${s.key}`

// Codes status_raw PRTG : 3 OK ; 4, 10 avertissement ; 5, 13, 14 erreur ; le reste inactif
export const tone = (code) => {
  if (code === 3) return 'ok'
  if ([4, 10].includes(code)) return 'warn'
  if ([5, 13, 14].includes(code)) return 'down'
  return 'idle'
}
export const TONE_LABEL = { ok: 'OK', warn: 'Avertissement', down: 'En erreur', idle: 'Inactif' }

// "2 #" -> 2 ; "0 %" -> 0 ; "12,5 MB" -> 12.5
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export const visibleChannels = (sensor) =>
  (sensor.channels || []).filter((c) => !HIDDEN_CHANNELS.includes(String(c.name).toLowerCase()))

// Décide si le capteur s'affiche avec une jauge, et avec quelles valeurs
export function getGauge(sensor) {
  const channels = (sensor.channels || []).map((c) => ({ ...c, n: num(c.value) }))
  const find = (re) => channels.find((c) => re.test(String(c.name).toLowerCase()))

  const actives = find(/\bactives?\b/)
  const total = find(/\btotal/)
  if (actives && total && actives.n !== null && total.n !== null) {
    return { value: actives.n, max: total.n, caption: 'connectés', note: `${actives.n} sur ${total.n} sessions ouvertes` }
  }
  const libre = channels.find(
    (c) => /(libre|free)/.test(String(c.name).toLowerCase()) && String(c.value).includes('%') && c.n !== null,
  )
  if (libre) {
    return { value: Math.round((100 - libre.n) * 10) / 10, max: 100, caption: '% utilisé', note: `${libre.n} % libre` }
  }
  if (String(sensor.value).includes('%') && num(sensor.value) !== null) {
    return { value: num(sensor.value), max: 100, caption: '%', note: null }
  }
  return null
}

// PRTG renvoie parfois du HTML dans "message"
export const plainText = (html) =>
  String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export const normalize = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Capteurs déclarés dans sensors.json, affichés « en attente » tant que le backend n'a pas répondu
export const placeholderItems = () =>
  sensorsConfig.map((c) => ({
    key: c.key,
    label: c.label,
    group: c.group,
    wide: !!c.wide,
    found: true,
    pending: true,
    device: null,
    status: 'En attente',
    status_raw: 0,
    value: null,
    message: null,
    channels: [],
  }))

// Données fictives pour voir le rendu sans PRTG : ouvrir la page avec ?demo
export function demoItems() {
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a))
  return sensorsConfig.map((c, i) => {
    const down = c.key === 'ping_mk_sr_goro'
    const warn = c.key === 'cpu' && c.group === 'RDS 2'
    const base = {
      key: c.key, label: c.label, group: c.group, wide: !!c.wide, found: true,
      device: `${c.group === 'Routeurs MikroTik' ? 'MK' : 'SRV'}-${c.group.replace(/\D/g, '') || 'R'}-${String(i + 1).padStart(2, '0')} (démo)`,
      status: down ? 'Erreur' : warn ? 'Avertissement' : 'OK',
      status_raw: down ? 5 : warn ? 4 : 3,
      message: down ? 'Délai d’attente de la requête dépassé (démo)' : warn ? 'Charge CPU au-dessus du seuil (démo)' : 'OK',
      channels: [],
    }
    if (c.key === 'rds') {
      const t = rnd(18, 30), a = rnd(6, t)
      return { ...base, value: `${a} #`, channels: [
        { name: 'Sessions actives', value: `${a} #` }, { name: 'Sessions inactives', value: `${t - a} #` }, { name: 'Sessions total', value: `${t} #` } ] }
    }
    if (c.key === 'cpu') return { ...base, value: `${warn ? rnd(86, 94) : rnd(9, 42)} %` }
    if (c.key === 'disque_c') {
      const free = rnd(18, 55)
      return { ...base, value: `${free} %`, channels: [
        { name: 'Espace libre', value: `${free} %` }, { name: 'Octets libres', value: `${rnd(20, 90)} GB` } ] }
    }
    return { ...base, value: down ? '' : `${rnd(1, 28)} msec` }
  })
}
