{% set server_url = salt['pillar.get']('itms:server_url', 'http://localhost:3001') %}
{% set ingest_token = salt['pillar.get']('itms:ingest_token', '') %}
{% set category = salt['pillar.get']('itms:asset_category', 'desktop') %}

itms-linux-refresh-now:
  cmd.run:
    - name: /usr/bin/python3 /opt/itms/push-system-inventory.py --server-url {{ server_url }} --token {{ ingest_token }} --category {{ category }}
    - onlyif: test -f /opt/itms/push-system-inventory.py