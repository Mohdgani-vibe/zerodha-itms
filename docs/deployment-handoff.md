# Deployment Handoff

Current validated branch and commit:

- Branch: `main`
- Commit: `a4cc759f99083bfa315526a20d306389d3f6eba1`
- Remote: `https://github.com/Mohdgani-vibe/zerodha-itms.git`

Validated on this server:

- Full release readiness passed with live integrations
- Frontend audit reports `0 vulnerabilities`
- Frontend production build passes on Vite `8.0.8`
- Backend compile/test pass succeeded
- Docker stack is healthy

## Update Existing Server

```bash
cd /home/itteam/itms
git fetch origin
git switch main
git pull --ff-only origin main
```

## Verify Frontend Dependencies

```bash
cd /home/itteam/itms/frontend
npm install
npm audit
npm run build
```

Expected result:

- `npm audit` returns `found 0 vulnerabilities`
- `npm run build` completes successfully

## Verify Backend

```bash
cd /home/itteam/itms/backend
go test ./...
```

Expected result:

- Go test completes without failures

## Full Readiness Check

Standard readiness:

```bash
cd /home/itteam/itms
./scripts/check-itms-release-readiness.sh
```

Readiness with live integrations:

```bash
cd /home/itteam/itms
./scripts/check-itms-release-readiness.sh --with-live-integrations
```

Expected result:

- Docker health passes
- API smoke test passes
- Salt and Wazuh auth report `auth-ok`
- Live Salt, Wazuh, ClamAV, and OpenSCAP verification pass
- Final output ends with `Release readiness checks completed successfully`

## Notes

- OpenSCAP may report permission-limited warnings and `exit=2` when run without sudo/root; this is expected in the current setup as long as the report is still generated and ingested.
- The frontend advisory cleanup was committed in `a4cc759`.
