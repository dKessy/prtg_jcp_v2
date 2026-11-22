# Moniteur PRTG JCP — site

Tableau de bord des capteurs PRTG de JCP (React + Vite).

Chaque capteur listé dans `../backup/sensors.json` devient un module 3D qui tourne autour du titre :
- **glisser** un module pour le lancer (il revient en place), **molette** pour faire tourner l'anneau ;
- **clic** sur un module : sa fiche s'ouvre (statut, valeur, message PRTG, canaux) et la couverture s'ouvre sur ses canaux ;
- **recherche** (touche `/`), filtres par **groupe** et par **état** (OK / avertissement / erreur) ;
- **Orbite / Grille** pour passer en vue grille ;
- **Épingler** un capteur pour le retrouver dans « Épinglés » (mémorisé dans le navigateur) ;
- clic sur le petit module du titre : mélange l'anneau.

Les données viennent du backend (`../backup`) via `GET /api/prtg/dashboard`, rafraîchies toutes les 30 s.

## Lancer

Backend (dans `../backup`, avec un `.env` contenant `PRTG_URL` et `PRTG_TOKEN`) :

```bash
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Site :

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173

- **Sans PRTG** : http://localhost:5173/?demo affiche des valeurs fictives (marquées « démo »).
- **Autre adresse de backend** : définir `VITE_DASHBOARD_URL` (ex. dans `.env.local`).
