# LLMFIXER-web (archived)

This repo holds an experimental marketing site (Next.js 16 + React 19 with a WebGPU/WebGL2 particle cosmos canvas). It was originally intended to live at the apex domain `thefixer.in/` and surface a `/get-key` flow that minted a one-shot trial `opto_*` API key.

**Status (2026-04-28): not deployed, no plans to deploy.** The product is the marketing; the apex `thefixer.in/` and the console `thefixer.in/app/*` are both served by [`llmfixer-app`](https://github.com/Problemsolver0070/llmfixer-app). The canonical reference for the live product is [`llmfixer-api/docs/PROJECT_REFERENCE.md`](https://github.com/Problemsolver0070/llmfixer-api/blob/main/docs/PROJECT_REFERENCE.md).

The code is left here as a snapshot in case the marketing-site direction is ever revisited. If you do revive it:

- The cosmos engine still depends on Three.js + TSL shaders (`components/canvas/cosmos-engine.ts`).
- The `/get-key` form posts to `api.thefixer.in/v1/keys/request`, which **does not currently exist on the backend**. You'd need to add that route on `llmfixer-api` first.
- A new Azure Static Web App (or path-routing on the existing `thefixer-web` SWA) is required for the apex binding; today the apex is owned by the console.

To work locally:

```bash
npm install
npm run dev
```

To stop developing on this repo: archive it on GitHub, or just leave it as-is.
