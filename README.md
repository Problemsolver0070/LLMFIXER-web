# LLMFIXER-web (archived)

Next.js 16 + React 19 marketing site with a WebGPU/WebGL2 particle canvas. Intended to serve the apex `thefixer.in/` and expose a `/get-key` flow that issued a trial `opto_*` API key.

Status (2026-04-28): not deployed. The apex `thefixer.in/` and console `thefixer.in/app/*` are served by [`llmfixer-app`](https://github.com/Problemsolver0070/llmfixer-app). See [`llmfixer-api/docs/PROJECT_REFERENCE.md`](https://github.com/Problemsolver0070/llmfixer-api/blob/main/docs/PROJECT_REFERENCE.md) for the live product reference.

Notes if reviving this repo:

- The cosmos engine uses Three.js + TSL shaders (`components/canvas/cosmos-engine.ts`).
- The `/get-key` form posts to `api.thefixer.in/v1/keys/request`, which is not implemented on the backend. The route must be added in `llmfixer-api` first.
- A new Azure Static Web App, or path-routing on the existing `thefixer-web` SWA, is required for the apex binding. The apex is currently owned by the console.

Local development:

```bash
npm install
npm run dev
```
