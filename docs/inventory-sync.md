# Inventory Sync Flow

## Goal

Inventory sync is owned by the backend.

There are now two supported paths:

1. Pull model: the ITMS backend fetches a JSON inventory feed on a schedule, default `24h`.
2. Push model: a system-side collector sends its own inventory snapshot directly to the ITMS backend.

Both paths end in the same backend upsert pipeline and write to PostgreSQL tables such as `assets`, `asset_compute_details`, and `asset_software_inventory`.

## Current Backend Support

The backend now includes:

- A scheduled inventory sync service in `backend/internal/inventorysync/service.go`
- Persistent run tracking in `inventory_sync_runs`
- A protected status endpoint at `/api/inventory-sync/status`
- A protected manual trigger endpoint at `/api/inventory-sync/run` for demo and operator use
- A token-protected direct ingest endpoint at `/api/inventory-sync/ingest`
- Live device-detail mapping from synced compute details to the UI
- A shared import pipeline used by both the scheduled pull and direct ingest paths

## Configuration

Set these in `backend/.env`:

```env
INVENTORY_SYNC_ENABLED=true
INVENTORY_SYNC_SOURCE_TYPE=json
INVENTORY_SYNC_SOURCE_URL=https://inventory.example.com/api/assets
INVENTORY_SYNC_SOURCE_TOKEN=...
INVENTORY_INGEST_TOKEN=replace-with-a-long-random-secret
INVENTORY_SYNC_INTERVAL=24h
INVENTORY_SYNC_RUN_ON_STARTUP=false
INVENTORY_SYNC_DEFAULT_ENTITY_ID=
INVENTORY_SYNC_DEFAULT_DEPT_ID=
INVENTORY_SYNC_DEFAULT_LOCATION_ID=
```

`INVENTORY_INGEST_TOKEN` is required only for the direct push model.

## Expected Source Payload

The current importer accepts either:

- a JSON object with an `assets` array
- or a raw JSON array

Example:

```json
{
  "assets": [
    {
      "asset_tag": "Z-IT-1001",
      "name": "Rahul Trading Laptop",
      "hostname": "zer-it-lt-1001",
      "category": "laptop",
      "is_compute": true,
      "serial_number": "SN-LT-1001",
      "manufacturer": "Lenovo",
      "model": "ThinkPad X1 Carbon Gen 11",
      "entity_id": "00000000-0000-0000-0000-000000000000",
      "dept_id": "00000000-0000-0000-0000-000000000000",
      "location_id": "00000000-0000-0000-0000-000000000000",
      "purchase_date": "2026-01-10",
      "warranty_until": "2027-08-30",
      "status": "in_use",
      "condition": "good",
      "glpi_id": 1241,
      "salt_minion_id": "zer-it-lt-1001",
      "wazuh_agent_id": "001",
      "notes": "Imported from inventory source",
      "compute_details": {
        "processor": "Intel Core Ultra 7 165U",
        "ram": "32 GB LPDDR5X",
        "storage": "1 TB NVMe SSD",
        "bios_version": "N3XET72W 1.41",
        "os_name": "Ubuntu 24.04 LTS",
        "os_version": "24.04",
        "kernel": "Linux 6.8.0-31-generic",
        "architecture": "x86_64",
        "os_build": "Ubuntu 24.04.1 LTS build 20260406.2",
        "last_seen": "2026-04-06T05:30:00Z",
        "pending_updates": 0
      },
      "installed_software": [
        {
          "name": "Google Chrome",
          "version": "123.0.6312.106",
          "install_date": "2026-04-01"
        }
      ],
      "security_reports": [
        {
          "source": "clamav",
          "status": "infected",
          "severity": "high",
          "title": "ClamAV detected threats",
          "summary": "Scanned 42 files; infected: 1; errors: 0.",
          "detail": "/tmp/eicar.com: Win.Test.EICAR_HDB-1 FOUND",
          "scanned_at": "2026-04-15T08:00:00Z",
          "scanned_paths": ["/tmp"],
          "infected_files": ["/tmp/eicar.com"],
          "scanned_file_count": 42,
          "infected_file_count": 1,
          "error_count": 0
        }
      ]
    }
  ]
}
```

## How To Fetch Details From Systems

There are two practical patterns:

1. Pull from a central inventory source.
   Use GLPI or another inventory platform as the source of truth, expose a JSON export or middleware endpoint, and let ITMS fetch it daily.

2. Push endpoint telemetry into a central exporter.
  Collect device details from endpoints using Salt, Wazuh, osquery, or a custom agent and send them straight to `/api/inventory-sync/ingest`.

For this repo, both pull and push models are implemented.

## Direct System To Server Push

The backend accepts a POST to:

```text
/api/inventory-sync/ingest
```

Authentication:

- `Authorization: Bearer <INVENTORY_INGEST_TOKEN>`
- or `X-Inventory-Token: <INVENTORY_INGEST_TOKEN>`

Example:

```bash
curl -X POST http://localhost:3001/api/inventory-sync/ingest \
  -H "Authorization: Bearer $INVENTORY_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @payload.json
```

The same JSON payload shape is accepted for both pull and push.

## Collector Script

Collector scripts are included at `scripts/push-system-inventory.py` for Linux and `scripts/push-system-inventory.ps1` for Windows.

## One-command agent install

If you want one command on the endpoint that installs the supported tools and registers the machine back to ITMS immediately, use the bootstrap scripts in `scripts/install-itms-agent.sh` and `scripts/install-itms-agent.ps1`.

Ubuntu or Debian:

```bash
sudo ./scripts/install-itms-agent.sh \
  --server-url http://itms.example.com:3001 \
  --token "$INVENTORY_INGEST_TOKEN" \
  --category laptop \
  --assigned-to-email employee@example.com \
  --use-hardinfo-fallback \
  --salt-master salt-master.example.com \
  --wazuh-manager wazuh-manager.example.com
```

Use `--use-hardinfo-fallback` only on Linux endpoints where you want `hardinfo` installed and used as a fallback source for display details. The richer CPU, RAM, storage, GPU, MAC address, and last boot fields are collected automatically even without that flag.

Windows:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-itms-agent.ps1 `
  -ServerUrl http://itms.example.com:3001 `
  -Token $env:INVENTORY_INGEST_TOKEN `
  -Category desktop `
  -UseDetailedHardwareInventory $true `
  -AssignedToEmail employee@example.com `
  -SaltMaster salt-master.example.com `
  -WazuhManager wazuh-manager.example.com
```

Use `-UseDetailedHardwareInventory $true` on Windows bootstrap commands when you want the scheduled collector command to explicitly include GPU, display, MAC address, and last boot collection. It defaults to enabled.

PowerShell one-liner from an elevated prompt on the endpoint:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '.\scripts\install-itms-agent.ps1' -ServerUrl 'http://itms.example.com:3001' -Token 'YOUR_INGEST_TOKEN' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'employee@example.com' -SaltMaster 'salt-master.example.com' -WazuhManager 'wazuh-manager.example.com'"
```

If you publish the installer script to an internal HTTPS URL, the same bootstrap can be run without copying repo files first:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest 'https://itms.example.com/install-itms-agent.ps1' -OutFile $scriptPath; & $scriptPath -ServerUrl 'http://itms.example.com:3001' -Token 'YOUR_INGEST_TOKEN' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'employee@example.com' -SaltMaster 'salt-master.example.com' -WazuhManager 'wazuh-manager.example.com'"
```

This backend now serves the installer script directly as:

```text
http://localhost:3001/installers/install-itms-agent.ps1
```

So the real one-line Windows bootstrap from an elevated PowerShell prompt is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest 'http://localhost:3001/installers/install-itms-agent.ps1' -OutFile $scriptPath; & $scriptPath -ServerUrl 'http://localhost:3001' -Token 'replace-with-your-inventory-ingest-token' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'user@zerodha.com' -SaltMaster '10.10.21.11' -WazuhManager 'wazuh.itms'"
```

What the bootstrap command does:

- installs Salt Minion
- installs the Wazuh agent
- installs ClamAV on Ubuntu or ClamWin on Windows
- installs OpenSCAP on Ubuntu
- optionally installs `hardinfo` on Ubuntu when `--use-hardinfo-fallback` is passed
- deploys the ITMS inventory collector
- configures recurring inventory refresh
- configures a daily 12:00 local-time ClamAV or ClamWin report push back to `/api/inventory-sync/ingest`
- configures a recurring OpenSCAP scan on Linux and can push the latest hardening result back to `/api/inventory-sync/ingest`
- sends an initial hardware, OS, and software snapshot to `/api/inventory-sync/ingest`

When the collector includes `security_reports`, the backend recognizes those reports and turns them into asset alerts and user alerts. ClamAV reports are surfaced under the `ClamAV` source, and OpenSCAP hardening reports are surfaced under `OpenSCAP Hardening` in the Alerts page. Both include asset ID, asset tag, hostname, and report detail.

Windows note: the bootstrap will install Chocolatey automatically when needed and then install Salt Minion through Chocolatey. Keep `-SaltMinionUrl` only as an override for locked-down environments that block Chocolatey.

Print the payload without sending it:

```bash
python3 scripts/push-system-inventory.py --print-only
```

Send a live inventory snapshot to the backend:

```bash
python3 scripts/push-system-inventory.py \
  --server-url http://localhost:3001 \
  --token "$INVENTORY_INGEST_TOKEN" \
  --assigned-to-email employee@zerodha.com \
  --category laptop
```

Attach the latest OpenSCAP hardening result from the Linux results directory when sending a snapshot:

```bash
python3 scripts/push-system-inventory.py \
  --server-url http://localhost:3001 \
  --token "$INVENTORY_INGEST_TOKEN" \
  --include-openscap-report
```

The same behavior can be enabled for scheduled runs with `ITMS_INCLUDE_OPENSCAP_REPORT=true` and `ITMS_OPENSCAP_RESULTS_DIR=/var/lib/itms/openscap`.

If `hardinfo` is installed and you want to use it only as a fallback source for display details, enable it explicitly:

```bash
ITMS_USE_HARDINFO_FALLBACK=true python3 scripts/push-system-inventory.py --print-only
```

The script gathers:

- hostname and asset tag
- manufacturer, model, BIOS version, serial number
- processor, memory, storage, GPU, and primary MAC address
- OS name, version, kernel, architecture
- last boot time and last seen time
- pending package update count
- installed packages from `dpkg` or `rpm`

## Windows Runtime Validation Checklist

Use this when you need to prove that the Windows bootstrap and collector work on a real endpoint.

1. Start from an elevated PowerShell prompt on the Windows endpoint.
2. Confirm the backend is reachable from the endpoint.
3. Run the one-line bootstrap command from this document or from the Users or Settings page.
4. Wait for the bootstrap to finish without an unhandled PowerShell error.

Example bootstrap shape:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest 'http://ITMS_SERVER/installers/install-itms-agent.ps1' -OutFile $scriptPath; & $scriptPath -ServerUrl 'http://ITMS_SERVER' -Token 'YOUR_INGEST_TOKEN' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'employee@zerodha.com' -AssignedToName 'Employee Name' -EmployeeCode 'EMP001' -DepartmentName 'IT' -SaltMaster 'salt-master.example.com' -WazuhManager 'wazuh-manager.example.com'"
```

Expected local results after bootstrap:

- `C:\ProgramData\ITMS\push-system-inventory.ps1` exists
- `C:\ProgramData\ITMS\itms-agent.env` exists
- scheduled task `ITMS Inventory Refresh` exists
- if `-OpenScapCommand` was supplied, scheduled task `ITMS Compliance Scan` exists
- service `salt-minion` exists
- service `WazuhSvc` exists when Wazuh installation succeeded
- the generated env file contains `ITMS_USE_DETAILED_HARDWARE_INVENTORY=true` when detailed hardware collection is enabled

Recommended local checks:

```powershell
Test-Path 'C:\ProgramData\ITMS\push-system-inventory.ps1'
Test-Path 'C:\ProgramData\ITMS\itms-agent.env'
Get-Content 'C:\ProgramData\ITMS\itms-agent.env'
Get-Service salt-minion,WazuhSvc
schtasks /Query /TN 'ITMS Inventory Refresh'
schtasks /Query /TN 'ITMS Compliance Scan'
```

Run a manual sync after bootstrap:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\ITMS\push-system-inventory.ps1" -ServerUrl 'http://ITMS_SERVER' -Token 'YOUR_INGEST_TOKEN' -Category 'auto' -UseDetailedHardwareInventory $true
```

Expected collector result:

- PowerShell returns JSON from the backend instead of a local exception
- the payload should include Windows-specific compute details for `gpu`, `display`, `mac_address`, `last_boot`, and `last_seen`

Optional payload-only check before sending:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\ITMS\push-system-inventory.ps1" -ServerUrl 'http://ITMS_SERVER' -Token 'YOUR_INGEST_TOKEN' -PrintOnly | Out-File "$env:TEMP\itms-inventory.json"
```

Backend verification after the sync:

1. Open the asset in the Devices list and confirm the machine appears.
2. Open the device detail view and confirm GPU, display, MAC address, last boot, and last seen are populated.
3. If you prefer API verification, request `/api/devices` or `/api/devices/:id` and confirm the same fields are present.
4. If you prefer database verification, query `asset_compute_details` for the asset and confirm the Windows fields persisted.

Example backend checks:

```bash
curl -H "Authorization: Bearer <session-or-api-token>" http://ITMS_SERVER/api/devices | jq '.items[] | {hostname, gpu, macAddress, lastSeenAt}'
curl -H "Authorization: Bearer <session-or-api-token>" http://ITMS_SERVER/api/devices/DEVICE_ID | jq '{hostname, gpu, display, macAddress, lastBootAt, lastSeenAt}'
```

```sql
select asset_tag, gpu, display, mac_address, last_boot, last_seen
from asset_compute_details
where asset_id = 'DEVICE_ID';
```

Failure points to check first:

- the PowerShell session was not elevated
- the endpoint could not download the installer or collector from the backend
- Chocolatey installation was blocked, preventing Salt Minion install
- the ingest token was wrong, causing `/api/inventory-sync/ingest` to reject the push
- Windows networking or local policy blocked Wazuh or Salt service startup
- `Get-NetAdapter` or `Get-CimInstance` returned incomplete hardware data on the endpoint, which usually means a host-specific Windows permissions or driver issue rather than a backend issue

## UI Consumption

The UI does not sync directly.

- `/api/devices` reads from synced asset records
- `/api/devices/:id` reads from synced compute details and software inventory
- `/api/inventory-sync/status` reports backend scheduler status and the latest run

That keeps sync logic in the server, not in the browser.