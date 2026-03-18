# H000019 EEfRT

HTML/browser preview of the EEfRT task built with `psyflow-web`.
Offer generation, low/high effort choice flow, effort execution, and probabilistic reward outcome are aligned to local `T000019-eefrt`; trial and effort counts are shortened for preview.

## Layout

- `main.ts`: task orchestration
- `config/config.yaml`: declarative config
- `src/run_trial.ts`: trial logic
- `src/utils.ts`: offer condition generation and summary helpers

## Run

From `e:\xhmhc\TaskBeacon\psyflow-web`:

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?task=H000019-eefrt
```
