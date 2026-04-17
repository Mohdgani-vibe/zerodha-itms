# Frontend Notes

## Stack

- React 19 + TypeScript + Vite
- Route-level code splitting via `React.lazy`
- Idle-time route preloading in the shared portal shell

## Common Commands

```bash
cd frontend
npm run lint
npm run build
npm run dev
npm run preview:stable
```

`npm run preview:stable` uses the repo helper at `/scripts/start-itms-frontend.sh` to keep preview pinned to port `4175` instead of silently drifting to another port when a stale preview process is present.

## Bundle Strategy

- Route components are lazy-loaded from [src/App.tsx](/home/itteam/itms/frontend/src/App.tsx).
- Post-login route warming runs from [src/components/layout/PortalLayout.tsx](/home/itteam/itms/frontend/src/components/layout/PortalLayout.tsx).
- Keep new page-level imports local to the route when possible. Avoid pulling large feature modules into shared layout or app-shell files.

## PDF Constraint

- Gatepass PDF generation uses direct jsPDF drawing APIs in [src/pages/Gatepass.tsx](/home/itteam/itms/frontend/src/pages/Gatepass.tsx).
- The build intentionally stubs jsPDF optional `html2canvas` and `dompurify` helpers through [vite.config.ts](/home/itteam/itms/frontend/vite.config.ts).
- Do not introduce `doc.html()`-style jsPDF flows unless you also remove or revise those stubs.

## Verified Status

- `npm run lint` passes.
- `npm run build` passes.
- The previous oversized main bundle warning was removed by route splitting and deferred PDF imports.