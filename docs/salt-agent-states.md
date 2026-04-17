# Salt State Examples For Ubuntu And Windows

These files map directly to the backend settings used by the real Install Agent button.

## Backend mapping

- `SALT_AGENT_INSTALL_STATE=itms_agent.install`
- `SALT_AGENT_INSTALL_UBUNTU_STATE=itms_agent.ubuntu`
- `SALT_AGENT_INSTALL_WINDOWS_STATE=itms_agent.windows`
- `SALT_INVENTORY_REFRESH_STATE=itms_inventory.refresh`
- `SALT_INVENTORY_REFRESH_UBUNTU_STATE=itms_inventory.ubuntu`
- `SALT_INVENTORY_REFRESH_WINDOWS_STATE=itms_inventory.windows`

The example files in this repo are:

- `scripts/salt/itms_agent/install.sls`
- `scripts/salt/itms_agent/ubuntu/init.sls`
- `scripts/salt/itms_agent/windows/init.sls`
- `scripts/salt/itms_inventory/refresh.sls`
- `scripts/salt/itms_inventory/ubuntu/init.sls`
- `scripts/salt/itms_inventory/windows/init.sls`
- `scripts/push-system-inventory.py`
- `scripts/push-system-inventory.ps1`

Copy them into your Salt fileserver, for example:

```text
salt://itms_agent/install.sls
salt://itms_agent/ubuntu/init.sls
salt://itms_agent/windows/init.sls
salt://itms_inventory/refresh.sls
salt://itms_inventory/ubuntu/init.sls
salt://itms_inventory/windows/init.sls
salt://itms/files/push-system-inventory.py
salt://itms/files/push-system-inventory.ps1
```

## State layout

- `itms_agent.install` remains the generic fallback state.
- `itms_agent.ubuntu.init` contains the Ubuntu/Debian package and service workflow.
- `itms_agent.windows.init` contains the Windows workflow.
- `itms_inventory.refresh` remains the generic fallback state for detail refresh.
- `itms_inventory.ubuntu.init` and `itms_inventory.windows.init` hold the OS-specific refresh commands.

## Required pillar values

```yaml
itms:
  server_url: http://itms-backend.example.com:3001
  ingest_token: replace-with-inventory-ingest-token
  asset_category: desktop
  salt_master: salt-master.example.com

wazuh:
  manager: wazuh-manager.example.com
  group: default
  windows_package_url: https://packages.wazuh.com/4.x/windows/wazuh-agent-4.8.2-1.msi

openscap:
  profile: xccdf_org.ssgproject.content_profile_standard
  datastream: /usr/share/xml/scap/ssg/content/ssg-ubuntu2404-ds.xml
  results_dir: /var/lib/itms/openscap
  scan_hours: 24
  windows_command: Start-Process 'C:\ApprovedScanner\scanner.exe' -ArgumentList '/scan' -Wait
  windows_scan_hours: 24
```

## Ubuntu behavior

The Ubuntu path in `itms_agent.install` does this:

- installs `salt-minion`
- installs `clamav` and `clamav-daemon`
- installs `openscap-scanner` and `ssg-base`
- deploys the Linux ITMS collector script
- writes `/etc/salt/minion.d/itms.conf` when `itms:salt_master` is supplied
- configures a systemd service and timer to push inventory every 6 hours
- installs the Wazuh agent from the official Wazuh APT repository
- rewrites `/var/ossec/etc/ossec.conf` with the configured Wazuh manager and group
- writes `/opt/itms/run-openscap-scan.sh` and enables `itms-openscap-scan.timer`
- keeps `salt-minion` and `clamav-daemon` running

The follow-up `itms_inventory.refresh` state runs the collector immediately so the device sends updated details back into ITMS right after the install button completes.

## Windows behavior

The Windows path in `itms_agent.install` does this:

- deploys the PowerShell collector script
- writes the ITMS server URL and ingest token to `C:\ProgramData\ITMS\itms-agent.env`
- installs `python3` and `salt-minion` using the Salt Windows package provider
- writes `C:\salt\conf\minion.d\itms.conf` when `itms:salt_master` is supplied
- installs ClamWin from a configurable direct installer URL because Windows ClamAV packaging varies across environments
- downloads and installs the Wazuh MSI
- rewrites the Windows Wazuh `ossec.conf` with the configured manager and group
- can schedule your approved Windows compliance command through `openscap:windows_command`
- creates a scheduled task to refresh inventory every 6 hours

The follow-up `itms_inventory.refresh` state runs the PowerShell collector immediately.

## Windows OpenSCAP note

OpenSCAP is a Linux-first tool. There is no standard Windows OpenSCAP package in the same way there is on Ubuntu. In the example Windows state, the OpenSCAP part is intentionally left as a notification/no-op. If your Windows compliance product is different, replace that section inside the Windows all-in-one state with your approved Windows compliance scanner.

For the direct Windows bootstrap script, use `-OpenScapCommand` when you want ITMS to persist and schedule your approved Windows compliance command. That keeps the install flow aligned with the Salt state even though native OpenSCAP packaging is not available on Windows.

## Operational flow

When the user clicks Install Agent in the portal:

1. ITMS calls `POST /api/assets/:id/script` with `install_itms_agent`.
2. The backend reads the device OS from inventory data.
3. Ubuntu devices run `SALT_AGENT_INSTALL_UBUNTU_STATE`; Windows devices run `SALT_AGENT_INSTALL_WINDOWS_STATE`; unknown devices fall back to `SALT_AGENT_INSTALL_STATE`.
4. The backend then runs the matching OS-specific refresh state, with `SALT_INVENTORY_REFRESH_STATE` as fallback.
5. The endpoint pushes fresh hardware, OS, and software inventory back to `/api/inventory-sync/ingest`.
6. The frontend reloads the device view and shows the updated status.

## Direct endpoint bootstrap

If you need a host-side one-command install instead of the portal-triggered Salt flow, use the repo bootstrap scripts:

- `scripts/install-itms-agent.sh` for Ubuntu or Debian endpoints
- `scripts/install-itms-agent.ps1` for Windows endpoints

They install the supported endpoint stack locally, configure inventory refresh, and push the first snapshot to ITMS immediately.

On Ubuntu or Debian, the direct bootstrap now does the full endpoint configuration as part of install:

- installs or reuses `salt-minion`, writes `/etc/salt/minion.d/itms.conf`, and restarts the service when `--salt-master` is provided
- installs or reuses `wazuh-agent`, rewrites `/var/ossec/etc/ossec.conf` with the supplied manager and group, and restarts the service when `--wazuh-manager` is provided
- installs `openscap-scanner` plus SCAP content when available, auto-detects the datastream, and writes `/opt/itms/run-openscap-scan.sh`
- creates `itms-openscap-scan.service` and `itms-openscap-scan.timer` so compliance scans continue after bootstrap

The Linux bootstrap supports these extra flags when you need to override compliance defaults:

- `--openscap-profile`
- `--openscap-datastream`
- `--openscap-results-dir`
- `--openscap-scan-hours`

On Windows, the bootstrap now installs Chocolatey automatically when needed so the normal install command does not need a separate Salt Minion package URL. Keep `-SaltMinionUrl` only as a fallback for restricted environments.

You can run it as a single PowerShell command from an elevated prompt:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '.\scripts\install-itms-agent.ps1' -ServerUrl 'http://itms.example.com:3001' -Token 'YOUR_INGEST_TOKEN' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'employee@example.com' -SaltMaster 'salt-master.example.com' -WazuhManager 'wazuh-manager.example.com'"
```

If the backend is reachable, you do not need to copy the script first. Download and run it in one command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest 'http://localhost:3001/installers/install-itms-agent.ps1' -OutFile $scriptPath; & $scriptPath -ServerUrl 'http://localhost:3001' -Token 'replace-with-your-inventory-ingest-token' -Category 'desktop' -UseDetailedHardwareInventory $true -AssignedToEmail 'user@zerodha.com' -SaltMaster '10.10.21.11' -WazuhManager 'wazuh.itms'"

For Windows endpoints managed through Salt, set `itms:use_detailed_hardware_inventory: true` in pillar if you want the scheduled collector command to keep the richer GPU, display, MAC address, and last boot fields explicit.
```

For Linux endpoints managed through Salt, set `itms:use_hardinfo_fallback: true` in pillar if you want the state to install `hardinfo` and export `ITMS_USE_HARDINFO_FALLBACK=true` for scheduled inventory refreshes.

## Recommended next step

If you use these examples in production, move any secrets out of inline file contents and into Salt pillar, Vault, or another secret backend.