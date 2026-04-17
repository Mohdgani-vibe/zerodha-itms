{% set server_url = salt['pillar.get']('itms:server_url', 'http://localhost:3001') %}
{% set ingest_token = salt['pillar.get']('itms:ingest_token', '') %}
{% set category = salt['pillar.get']('itms:asset_category', 'desktop') %}
{% set salt_master = salt['pillar.get']('itms:salt_master', '') %}
{% set wazuh_manager = salt['pillar.get']('wazuh:manager', '') %}
{% set wazuh_group = salt['pillar.get']('wazuh:group', 'default') %}
{% set openscap_profile = salt['pillar.get']('openscap:profile', 'xccdf_org.ssgproject.content_profile_standard') %}
{% set openscap_datastream = salt['pillar.get']('openscap:datastream', '/usr/share/xml/scap/ssg/content/ssg-ubuntu2404-ds.xml') %}
{% set openscap_results_dir = salt['pillar.get']('openscap:results_dir', '/var/lib/itms/openscap') %}
{% set openscap_scan_hours = salt['pillar.get']('openscap:scan_hours', 24) %}
{% set use_hardinfo_fallback = salt['pillar.get']('itms:use_hardinfo_fallback', false) %}

itms-agent-ubuntu-prereqs:
  pkg.installed:
    - pkgs:
      - python3
      - python3-requests
      - ca-certificates
      - curl
      - gnupg
      - apt-transport-https
      - salt-minion
      - clamav
      - clamav-daemon
      - openscap-scanner
      - ssg-base
    {% if use_hardinfo_fallback %}
      - hardinfo
    {% endif %}

itms-linux-collector-script:
  file.managed:
    - name: /opt/itms/push-system-inventory.py
    - source: salt://itms/files/push-system-inventory.py
    - makedirs: True
    - mode: '0755'

itms-linux-env:
  file.managed:
    - name: /etc/itms-agent.env
    - makedirs: True
    - mode: '0600'
    - contents: |
        ITMS_SERVER_URL={{ server_url }}
        ITMS_INGEST_TOKEN={{ ingest_token }}
        ITMS_ASSET_CATEGORY={{ category }}
        ITMS_SALT_MASTER={{ salt_master }}
        ITMS_WAZUH_MANAGER={{ wazuh_manager }}
        ITMS_WAZUH_GROUP={{ wazuh_group }}
        ITMS_OPENSCAP_PROFILE={{ openscap_profile }}
        ITMS_OPENSCAP_DATASTREAM={{ openscap_datastream }}
        ITMS_OPENSCAP_RESULTS_DIR={{ openscap_results_dir }}
{% if use_hardinfo_fallback %}
        ITMS_USE_HARDINFO_FALLBACK=true
{% endif %}

{% if salt_master %}
itms-linux-salt-config:
  file.managed:
    - name: /etc/salt/minion.d/itms.conf
    - makedirs: True
    - mode: '0644'
    - contents: |
        master: {{ salt_master }}
{% endif %}

itms-linux-wazuh-repo:
  cmd.run:
    - name: |
        set -e
        curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg
        echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list
        apt-get update
    - unless: test -f /etc/apt/sources.list.d/wazuh.list
    - require:
      - pkg: itms-agent-ubuntu-prereqs

itms-linux-wazuh-agent:
  cmd.run:
    - name: |
        set -e
        WAZUH_MANAGER='{{ wazuh_manager }}' WAZUH_AGENT_GROUP='{{ wazuh_group }}' apt-get install -y wazuh-agent
    - unless: dpkg-query -W -f='${Status}' wazuh-agent 2>/dev/null | grep -q 'install ok installed'
    - require:
      - cmd: itms-linux-wazuh-repo

{% if wazuh_manager %}
itms-linux-wazuh-config:
  cmd.run:
    - name: |
        python3 - <<'PY'
        import pathlib
        import xml.etree.ElementTree as ET

        config_path = pathlib.Path('/var/ossec/etc/ossec.conf')
        tree = ET.parse(config_path)
        root = tree.getroot()
        client = root.find('client')
        if client is None:
            client = ET.SubElement(root, 'client')
        server = client.find('server')
        if server is None:
            server = ET.SubElement(client, 'server')
        address = server.find('address')
        if address is None:
            address = ET.SubElement(server, 'address')
        address.text = '{{ wazuh_manager }}'
        agent = root.find('agent')
        if agent is None:
            agent = ET.SubElement(root, 'agent')
        groups = agent.find('groups')
        if groups is None:
            groups = ET.SubElement(agent, 'groups')
        groups.text = '{{ wazuh_group }}'
        tree.write(config_path, encoding='unicode', xml_declaration=False)
        PY
    - require:
      - cmd: itms-linux-wazuh-agent
{% endif %}

itms-linux-openscap-results-dir:
  file.directory:
    - name: {{ openscap_results_dir }}
    - makedirs: True
    - mode: '0755'

itms-linux-openscap-runner:
  file.managed:
    - name: /opt/itms/run-openscap-scan.sh
    - mode: '0755'
    - contents: |
        #!/usr/bin/env bash
        set -euo pipefail
        if [[ -f /etc/itms-agent.env ]]; then
          set -a
          . /etc/itms-agent.env
          set +a
        fi
        RESULTS_DIR="${ITMS_OPENSCAP_RESULTS_DIR:-{{ openscap_results_dir }}}"
        PROFILE="${ITMS_OPENSCAP_PROFILE:-{{ openscap_profile }}}"
        DATASTREAM="${ITMS_OPENSCAP_DATASTREAM:-{{ openscap_datastream }}}"
        mkdir -p "$RESULTS_DIR"
        STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
        oscap xccdf eval \
          --profile "$PROFILE" \
          --results "$RESULTS_DIR/openscap-results-$STAMP.xml" \
          --report "$RESULTS_DIR/openscap-report-$STAMP.html" \
          "$DATASTREAM"
    - require:
      - pkg: itms-agent-ubuntu-prereqs
      - file: itms-linux-openscap-results-dir

itms-linux-openscap-service:
  file.managed:
    - name: /etc/systemd/system/itms-openscap-scan.service
    - mode: '0644'
    - contents: |
        [Unit]
        Description=Run ITMS OpenSCAP scan
        After=network-online.target

        [Service]
        Type=oneshot
        EnvironmentFile=/etc/itms-agent.env
        ExecStart=/opt/itms/run-openscap-scan.sh

        [Install]
        WantedBy=multi-user.target

itms-linux-openscap-timer:
  file.managed:
    - name: /etc/systemd/system/itms-openscap-scan.timer
    - mode: '0644'
    - contents: |
        [Unit]
        Description=Run ITMS OpenSCAP scan every {{ openscap_scan_hours }} hours

        [Timer]
        OnBootSec=15min
        OnUnitActiveSec={{ openscap_scan_hours }}h
        Unit=itms-openscap-scan.service

        [Install]
        WantedBy=timers.target

clamav-daemon-service:
  service.running:
    - name: clamav-daemon
    - enable: True
    - require:
      - pkg: itms-agent-ubuntu-prereqs

clamav-freshclam-service:
  service.running:
    - name: clamav-freshclam
    - enable: True
    - require:
      - pkg: itms-agent-ubuntu-prereqs

salt-minion-service:
  service.running:
    - name: salt-minion
    - enable: True
    - require:
      - pkg: itms-agent-ubuntu-prereqs

itms-linux-refresh-service:
  file.managed:
    - name: /etc/systemd/system/itms-inventory-refresh.service
    - mode: '0644'
    - contents: |
        [Unit]
        Description=Push ITMS inventory snapshot
        After=network-online.target

        [Service]
        Type=oneshot
        EnvironmentFile=/etc/itms-agent.env
        ExecStart=/usr/bin/python3 /opt/itms/push-system-inventory.py --server-url ${ITMS_SERVER_URL} --token ${ITMS_INGEST_TOKEN} --category ${ITMS_ASSET_CATEGORY}

        [Install]
        WantedBy=multi-user.target

itms-linux-refresh-timer:
  file.managed:
    - name: /etc/systemd/system/itms-inventory-refresh.timer
    - mode: '0644'
    - contents: |
        [Unit]
        Description=Run ITMS inventory refresh every 6 hours

        [Timer]
        OnBootSec=5min
        OnUnitActiveSec=6h
        Unit=itms-inventory-refresh.service

        [Install]
        WantedBy=timers.target

itms-linux-systemd-reload:
  cmd.run:
    - name: systemctl daemon-reload
    - onchanges:
      - file: itms-linux-openscap-service
      - file: itms-linux-openscap-timer
      - file: itms-linux-refresh-service
      - file: itms-linux-refresh-timer

{% if wazuh_manager %}
wazuh-agent-service:
  service.running:
    - name: wazuh-agent
    - enable: True
    - require:
      - cmd: itms-linux-wazuh-agent
      - cmd: itms-linux-wazuh-config
{% else %}
wazuh-agent-service:
  service.running:
    - name: wazuh-agent
    - enable: True
    - require:
      - cmd: itms-linux-wazuh-agent
{% endif %}

itms-linux-refresh-timer-running:
  service.running:
    - name: itms-inventory-refresh.timer
    - enable: True
    - require:
      - file: itms-linux-refresh-timer
      - cmd: itms-linux-systemd-reload

itms-linux-openscap-timer-running:
  service.running:
    - name: itms-openscap-scan.timer
    - enable: True
    - require:
      - file: itms-linux-openscap-timer
      - cmd: itms-linux-systemd-reload