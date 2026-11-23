# Moniteur PRTG JCP — v2

Tableau de bord des capteurs PRTG de JCP : chaque capteur devient un module 3D qui tourne autour du titre
(lancer à la souris, fiche détaillée avec les canaux, recherche, filtres par groupe et par état, vue grille, épinglés).

En bas de la page, la section **Trafic réseau (IPFIX)** reprend le capteur IPFIX de PRTG :
jauges de débit par canal, graphique empilé (10 heures / 2 jours / 30 jours), une fenêtre par classement
(adresses IP les plus actives, connexions les plus utilisées, protocoles les plus utilisés) et le tableau des canaux.

- `backup/` — backend Python (FastAPI) : interroge l'API PRTG avec le token et renvoie les capteurs listés dans `sensors.json`
- `site-prtg/` — site React + Vite

## Lancer

Backend (créer `backup/.env` à partir de `backup/.env.example`, avec `PRTG_URL`, `PRTG_TOKEN` et `IPFIX_SENSOR_ID`) :

```bash
cd backup
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Site :

```bash
cd site-prtg
npm install
npm run dev
```

Puis ouvrir http://localhost:5173 — ou http://localhost:5173/?demo pour voir le rendu avec des valeurs fictives, sans PRTG.

## Capteur IPFIX

- `IPFIX_SENSOR_ID` : ID du capteur (visible dans l'URL `sensor.htm?id=...`), 18676 par défaut.
- `IPFIX_TOPNUMBER` : classement à lire, `live` = celui en cours.
- Endpoint : `GET /api/prtg/ipfix?range=10h|2j|30j`. Si une partie échoue (historique, classement…), le reste s'affiche quand même.
- Les classements sont lus via `table.xml?content=topdata`. Pour voir les colonnes exactes renvoyées par votre PRTG :
  http://localhost:8000/api/prtg/ipfix/raw/1 (puis 2 et 3).
