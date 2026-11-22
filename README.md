# Moniteur PRTG JCP — v2

Tableau de bord des capteurs PRTG de JCP : chaque capteur devient un module 3D qui tourne autour du titre
(lancer à la souris, fiche détaillée avec les canaux, recherche, filtres par groupe et par état, vue grille, épinglés).

- `backup/` — backend Python (FastAPI) : interroge l'API PRTG avec le token et renvoie les capteurs listés dans `sensors.json`
- `site-prtg/` — site React + Vite

## Lancer

Backend (créer `backup/.env` à partir de `backup/.env.example`) :

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
