import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

import requests
import urllib3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
# PRTG utilise souvent un certificat auto-signé
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

PRTG_URL = os.getenv("PRTG_URL", "").rstrip("/")
PRTG_TOKEN = os.getenv("PRTG_TOKEN", "").strip()
SENSORS_FILE = Path(__file__).parent / "sensors.json"
CACHE_SECONDS = 20
IPFIX_SENSOR_ID = int(os.getenv("IPFIX_SENSOR_ID", "18676") or 0)
# ID des classements (subid dans l'URL toplist.htm) : 1 adresses IP, 2 connexions, 3 protocoles
IPFIX_TOPLISTS = {
    1: "Adresses IP les plus actives",
    2: "Connexions les plus utilisées",
    3: "Protocoles les plus utilisés",
}
IPFIX_TOPNUMBER = os.getenv("IPFIX_TOPNUMBER", "live").strip() or "live"
IPFIX_CACHE_SECONDS = 60
# plage -> (durée, moyenne en secondes)
IPFIX_RANGES = {"10h": (timedelta(hours=10), 300), "2j": (timedelta(days=2), 3600), "30j": (timedelta(days=30), 21600)}

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_cache = {"ts": 0.0, "data": None}


def prtg_raw(path: str, params: dict):
    """Appelle l'API PRTG avec le token. Le token ne sort jamais du backend."""
    if not PRTG_URL or not PRTG_TOKEN:
        raise HTTPException(status_code=500, detail="PRTG_URL ou PRTG_TOKEN manquant dans .env")

    # safe="=," : on garde les "=" du token et les virgules des colonnes tels quels
    qs = urlencode({**params, "apitoken": PRTG_TOKEN}, safe="=,")
    try:
        r = requests.get(f"{PRTG_URL}{path}?{qs}", verify=False, timeout=10)
    except requests.RequestException as e:
        print(f"[PRTG] {type(e).__name__}")  # pas de message complet : il contiendrait l'URL
        raise HTTPException(status_code=502, detail="PRTG injoignable")

    print(f"[PRTG] {path} -> HTTP {r.status_code}")
    if not r.ok:
        raise HTTPException(status_code=502, detail=f"PRTG a refusé l'accès (HTTP {r.status_code})")
    return r


def prtg_get(path: str, params: dict):
    return prtg_raw(path, params).json()


def load_sensors():
    """Relit sensors.json à chaque appel : pas besoin de relancer le serveur après une modification."""
    try:
        sensors = json.loads(SENSORS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="sensors.json introuvable dans le dossier backend")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"sensors.json invalide (ligne {e.lineno})")
    if not isinstance(sensors, list):
        raise HTTPException(status_code=500, detail="sensors.json doit contenir une liste")
    return sensors


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/api/prtg/sensors")
def list_sensors():
    """Liste brute des capteurs, pratique pour retrouver un ID."""
    data = prtg_get("/api/table.json", {
        "content": "sensors",
        "output": "json",
        "columns": "objid,device,sensor,status,lastvalue",
        "count": 2000,
    })
    return data.get("sensors", [])


@app.get("/api/prtg/search")
def search_sensors(q: str):
    """Ex : /api/prtg/search?q=cpu  (cherche dans le nom du capteur et de l'appareil)."""
    q = q.lower()
    return [
        s for s in list_sensors()
        if q in s.get("sensor", "").lower() or q in s.get("device", "").lower()
    ]


@app.get("/api/prtg/channels/{sensor_id}")
def get_channels(sensor_id: int):
    """Canaux d'un capteur, pour voir leurs noms exacts."""
    data = prtg_get("/api/table.json", {
        "content": "channels",
        "output": "json",
        "id": sensor_id,
        "columns": "name,lastvalue,lastvalue_raw",
    })
    return data.get("channels", [])


@app.get("/api/prtg/dashboard")
def dashboard():
    """Renvoie les capteurs listés dans sensors.json, prêts à afficher."""
    if _cache["data"] is not None and time.time() - _cache["ts"] < CACHE_SECONDS:
        return _cache["data"]

    config = load_sensors()
    data = prtg_get("/api/table.json", {
        "content": "sensors",
        "output": "json",
        "columns": "objid,device,sensor,status,status_raw,lastvalue,message",
        "count": 2000,
    })
    par_id = {int(s["objid"]): s for s in data.get("sensors", [])}

    resultat = []
    for cfg in config:
        s = par_id.get(cfg.get("id"))
        if not s:
            resultat.append({
                "key": cfg.get("key"),
                "label": cfg.get("label"),
                "group": cfg.get("group"),
                "wide": bool(cfg.get("wide")),
                "found": False,
            })
            continue

        item = {
            "key": cfg.get("key"),
            "label": cfg.get("label"),
            "group": cfg.get("group"),
            "wide": bool(cfg.get("wide")),
            "found": True,
            "device": s.get("device"),
            "status": s.get("status"),
            "status_raw": int(s.get("status_raw") or 0),
            "value": s.get("lastvalue"),
            "message": s.get("message"),
        }
        if cfg.get("channels"):
            ch = prtg_get("/api/table.json", {
                "content": "channels",
                "output": "json",
                "id": cfg["id"],
                "columns": "name,lastvalue",
            })
            item["channels"] = [
                {"name": c.get("name"), "value": c.get("lastvalue")}
                for c in ch.get("channels", [])
                if c.get("name") != "Downtime"  # canal technique ajouté par PRTG
            ]
        resultat.append(item)

    _cache.update(ts=time.time(), data=resultat)
    return resultat

# ---------------------------------------------------------------- IPFIX

_ipfix_cache = {}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _part(fn):
    """Exécute un morceau de la réponse IPFIX : une erreur n'empêche pas le reste de s'afficher."""
    try:
        return fn(), None
    except HTTPException as e:
        return None, e.detail
    except Exception as e:  # format inattendu
        print(f"[IPFIX] {type(e).__name__}: {e}")
        return None, f"réponse PRTG inattendue ({type(e).__name__})"


def _ipfix_sensor():
    data = prtg_get("/api/table.json", {
        "content": "sensors",
        "output": "json",
        "filter_objid": IPFIX_SENSOR_ID,
        "columns": "objid,device,sensor,status,status_raw,lastvalue,message,lastcheck,lastup,interval,type",
    })
    rows = data.get("sensors", [])
    if not rows:
        raise HTTPException(status_code=404, detail=f"capteur {IPFIX_SENSOR_ID} introuvable")
    s = rows[0]
    s["status_raw"] = int(s.get("status_raw") or 0)
    return s


def _ipfix_channels():
    data = prtg_get("/api/table.json", {
        "content": "channels",
        "output": "json",
        "id": IPFIX_SENSOR_ID,
        "columns": "objid,name,lastvalue,lastvalue_raw",
    })
    return [
        {"id": c.get("objid"), "name": c.get("name"), "value": c.get("lastvalue"), "raw": _num(c.get("lastvalue_raw"))}
        for c in data.get("channels", [])
        if c.get("name") not in ("Downtime", "Temps mort")
    ]


def _ipfix_history(rng: str):
    span, avg = IPFIX_RANGES[rng]
    end = datetime.now()
    fmt = "%Y-%m-%d-%H-%M-%S"
    data = prtg_get("/api/historicdata.json", {
        "id": IPFIX_SENSOR_ID,
        "avg": avg,
        "sdate": (end - span).strftime(fmt),
        "edate": end.strftime(fmt),
        "usecaption": 1,
    })
    points = []
    for row in data.get("histdata", []):
        # créneau sans aucune mesure (en cours ou trou de collecte) : on l'ignore
        if _num(row.get("coverage_raw")) == 0:
            continue
        values = {
            k: _num(v) for k, v in row.items()
            if k not in ("datetime", "datetime_raw", "coverage", "coverage_raw") and _num(v) is not None
        }
        points.append({"t": row.get("datetime"), "t_raw": _num(row.get("datetime_raw")), "values": values})
    return {"range": rng, "avg": avg, "points": points}


def _ipfix_toplist(subid: int):
    """Les classements ne sont disponibles qu'en XML : on renvoie chaque <item> sous forme de dictionnaire."""
    r = prtg_raw("/api/table.xml", {
        "content": "topdata",
        "id": IPFIX_SENSOR_ID,
        "subid": subid,
        "topnumber": IPFIX_TOPNUMBER,
        "count": 50,
    })
    root = ET.fromstring(r.content)
    rows = []
    for item in root.iter("item"):
        row = {}
        for child in item:
            row[child.tag] = (child.text or "").strip()
        if row:
            rows.append(row)
    return {"subid": subid, "title": IPFIX_TOPLISTS.get(subid, f"Classement {subid}"), "rows": rows}


@app.get("/api/prtg/ipfix")
def ipfix(range: str = "10h"):
    """Capteur IPFIX : infos, canaux, historique et les trois classements (Top lists)."""
    if not IPFIX_SENSOR_ID:
        raise HTTPException(status_code=500, detail="IPFIX_SENSOR_ID manquant dans .env")
    if range not in IPFIX_RANGES:
        raise HTTPException(status_code=400, detail=f"range doit valoir {', '.join(IPFIX_RANGES)}")

    cached = _ipfix_cache.get(range)
    if cached and time.time() - cached[0] < IPFIX_CACHE_SECONDS:
        return cached[1]

    errors = {}
    sensor, errors["sensor"] = _part(_ipfix_sensor)
    channels, errors["channels"] = _part(_ipfix_channels)
    history, errors["history"] = _part(lambda: _ipfix_history(range))
    toplists = []
    for subid in IPFIX_TOPLISTS:
        top, err = _part(lambda subid=subid: _ipfix_toplist(subid))
        toplists.append(top or {"subid": subid, "title": IPFIX_TOPLISTS[subid], "rows": [], "error": err})

    result = {
        "id": IPFIX_SENSOR_ID,
        "sensor": sensor,
        "channels": channels or [],
        "history": history or {"range": range, "points": []},
        "toplists": toplists,
        "errors": {k: v for k, v in errors.items() if v},
    }
    if not result["errors"] and all(not t.get("error") for t in toplists):
        _ipfix_cache[range] = (time.time(), result)
    return result


@app.get("/api/prtg/ipfix/raw/{subid}")
def ipfix_raw(subid: int):
    """Diagnostic : contenu brut d'un classement, pour voir les noms de colonnes renvoyés par PRTG."""
    return _ipfix_toplist(subid)
