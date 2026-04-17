{% set server_url = salt['pillar.get']('itms:server_url', 'http://localhost:3001') %}
{% set ingest_token = salt['pillar.get']('itms:ingest_token', '') %}
{% set category = salt['pillar.get']('itms:asset_category', 'desktop') %}

itms-windows-refresh-now:
  cmd.run:
    - name: powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\ITMS\push-system-inventory.ps1 -ServerUrl {{ server_url }} -Token {{ ingest_token }} -Category {{ category }}
    - shell: cmd
    - onlyif: if exist C:\ProgramData\ITMS\push-system-inventory.ps1 (exit 0) else (exit 1)