{% set server_url = salt['pillar.get']('itms:server_url', 'http://localhost:3001') %}
{% set ingest_token = salt['pillar.get']('itms:ingest_token', '') %}
{% set category = salt['pillar.get']('itms:asset_category', 'desktop') %}
{% set salt_master = salt['pillar.get']('itms:salt_master', '') %}
{% set wazuh_manager = salt['pillar.get']('wazuh:manager', '') %}
{% set wazuh_group = salt['pillar.get']('wazuh:group', 'default') %}
{% set wazuh_windows_package = salt['pillar.get']('wazuh:windows_package_url', 'https://packages.wazuh.com/4.x/windows/wazuh-agent-4.8.2-1.msi') %}
{% set clamav_windows_package = salt['pillar.get']('clamav:windows_package_url', 'https://www.clamwin.com/content/download/clamwin-free-antivirus-installer.exe') %}
{% set openscap_windows_command = salt['pillar.get']('openscap:windows_command', '') %}
{% set openscap_windows_scan_hours = salt['pillar.get']('openscap:windows_scan_hours', 24) %}
{% set use_detailed_hardware_inventory = salt['pillar.get']('itms:use_detailed_hardware_inventory', true) %}

itms-windows-directory:
  file.directory:
    - name: C:\ProgramData\ITMS

itms-windows-collector-script:
  file.managed:
    - name: C:\ProgramData\ITMS\push-system-inventory.ps1
    - source: salt://itms/files/push-system-inventory.ps1
    - makedirs: True
    - require:
      - file: itms-windows-directory

itms-windows-config:
  file.managed:
    - name: C:\ProgramData\ITMS\itms-agent.env
    - contents: |
        ITMS_SERVER_URL={{ server_url }}
        ITMS_INGEST_TOKEN={{ ingest_token }}
        ITMS_ASSET_CATEGORY={{ category }}
        ITMS_SALT_MASTER={{ salt_master }}
        ITMS_WAZUH_MANAGER={{ wazuh_manager }}
        ITMS_WAZUH_GROUP={{ wazuh_group }}
        ITMS_USE_DETAILED_HARDWARE_INVENTORY={{ 'true' if use_detailed_hardware_inventory else 'false' }}

{% if salt_master %}
itms-windows-salt-config:
  file.managed:
    - name: C:\salt\conf\minion.d\itms.conf
    - makedirs: True
    - contents: |
        master: {{ salt_master }}
    - require:
      - pkg: itms-windows-salt-minion
{% endif %}
    - require:
      - file: itms-windows-directory

itms-windows-python:
  pkg.installed:
    - name: python3

itms-windows-salt-minion:
  pkg.installed:
    - name: salt-minion

itms-windows-clamwin:
  cmd.run:
    - name: |
        $ProgressPreference = 'SilentlyContinue'
        $package = 'C:\ProgramData\ITMS\clamwin-installer.exe'
        Invoke-WebRequest -Uri '{{ clamav_windows_package }}' -OutFile $package
        Start-Process $package -Wait -ArgumentList '/S'
    - shell: powershell
    - unless: |
        $installed = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -like 'ClamWin*' -or $_.DisplayName -like 'ClamAV*' }
        if ($installed) { exit 0 } else { exit 1 }

itms-windows-wazuh-agent:
  cmd.run:
    - name: |
        $ProgressPreference = 'SilentlyContinue'
        $package = 'C:\ProgramData\ITMS\wazuh-agent.msi'
        Invoke-WebRequest -Uri '{{ wazuh_windows_package }}' -OutFile $package
        Start-Process msiexec.exe -Wait -ArgumentList "/i `"$package`" /qn WAZUH_MANAGER={{ wazuh_manager }} WAZUH_AGENT_GROUP={{ wazuh_group }}"
    - shell: powershell
    - unless: |
        $installed = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -like 'Wazuh Agent*' }
        if ($installed) { exit 0 } else { exit 1 }

{% if wazuh_manager %}
itms-windows-wazuh-config:
  cmd.run:
    - name: |
        $configPaths = @(
          'C:\Program Files (x86)\ossec-agent\ossec.conf',
          'C:\Program Files\ossec-agent\ossec.conf'
        )
        $configPath = $configPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $configPath) {
          throw 'Wazuh config file not found.'
        }
        [xml]$xml = Get-Content -Path $configPath
        $root = $xml.ossec_config
        $client = $root.client
        if (-not $client) {
          $client = $xml.CreateElement('client')
          [void]$root.AppendChild($client)
        }
        $server = $client.server
        if (-not $server) {
          $server = $xml.CreateElement('server')
          [void]$client.AppendChild($server)
        }
        $address = $server.address
        if (-not $address) {
          $address = $xml.CreateElement('address')
          [void]$server.AppendChild($address)
        }
        $address.InnerText = '{{ wazuh_manager }}'
        $agent = $root.agent
        if (-not $agent) {
          $agent = $xml.CreateElement('agent')
          [void]$root.AppendChild($agent)
        }
        $groups = $agent.groups
        if (-not $groups) {
          $groups = $xml.CreateElement('groups')
          [void]$agent.AppendChild($groups)
        }
        $groups.InnerText = '{{ wazuh_group }}'
        $xml.Save($configPath)
        Restart-Service -Name WazuhSvc -ErrorAction SilentlyContinue
    - shell: powershell
    - require:
      - cmd: itms-windows-wazuh-agent
{% endif %}

itms-windows-openscap-note:
  test.succeed_without_changes:
    - name: OpenSCAP has no standard Windows package on Windows. Use openscap:windows_command to run your approved Windows compliance scanner through ITMS.

{% if openscap_windows_command %}
itms-windows-compliance-runner:
  file.managed:
    - name: C:\ProgramData\ITMS\run-compliance-scan.ps1
    - makedirs: True
    - contents: |
        $ErrorActionPreference = 'Stop'
        $command = @'
        {{ openscap_windows_command }}
        '@
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command
    - require:
      - file: itms-windows-directory

itms-windows-compliance-task:
  cmd.run:
    - name: |
        schtasks /Create /TN "ITMS Compliance Scan" /SC HOURLY /MO {{ openscap_windows_scan_hours }} /RU SYSTEM /F /TR "powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\ITMS\run-compliance-scan.ps1"
    - shell: cmd
    - require:
      - file: itms-windows-compliance-runner
{% endif %}

itms-windows-inventory-task:
  cmd.run:
    - name: |
        schtasks /Create /TN "ITMS Inventory Refresh" /SC HOURLY /MO 6 /RU SYSTEM /F /TR "powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\ITMS\push-system-inventory.ps1 -ServerUrl {{ server_url }} -Token {{ ingest_token }} -Category {{ category }} -UseDetailedHardwareInventory {{ '$true' if use_detailed_hardware_inventory else '$false' }}"
    - shell: cmd
    - require:
      - file: itms-windows-collector-script