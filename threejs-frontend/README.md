# Three.js Frontend - Phase Five

This subproject now includes:

- a Three.js frontend with live HUD controls
- a FastAPI bridge that reuses `dicegame/engine.py`
- end-to-end gameplay actions for roll, selection preview, take, continue, bank, and farkle resolution
- deterministic scene animation for roll, take-selection, and continue-turn transitions
- flat landing alignment so dice settle flush on the tray surface
- hover feedback, selected ring emphasis, and grounded contact shadows
- transient phase banners for new game, turn change, scoring, and game-over states
- vendor chunk splitting in Vite so build output stays cleaner

## Backend

```bash
cd threejs-frontend
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --reload --port 8000
```

## Frontend

If PowerShell blocks `npm.ps1`, use `npm.cmd` explicitly:

```bash
cd threejs-frontend
npm.cmd install --cache ".npm-cache"
npm.cmd run dev
```

## Development ports

- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:8000`

The Vite dev server proxies `/api` to the FastAPI backend.
