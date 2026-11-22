import json
import os
import time
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

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_cache = {"ts": 0.0, "data": None}


def prtg_get(path: str, params: dict):
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
    return r.json()


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