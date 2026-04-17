{% if grains['kernel'] == 'Linux' and grains['os_family'] == 'Debian' %}
include:
  - itms_agent.ubuntu.init

{% elif grains['kernel'] == 'Windows' %}
include:
  - itms_agent.windows.init

{% else %}
itms-agent-unsupported-platform:
  test.fail_without_changes:
    - name: itms_agent.install only ships example package commands for Ubuntu/Debian Linux and Windows.
{% endif %}