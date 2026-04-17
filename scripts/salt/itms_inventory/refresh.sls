{% if grains['kernel'] == 'Linux' and grains['os_family'] == 'Debian' %}
include:
  - itms_inventory.ubuntu.init

{% elif grains['kernel'] == 'Windows' %}
include:
  - itms_inventory.windows.init

{% else %}
itms-refresh-unsupported-platform:
  test.fail_without_changes:
    - name: itms_inventory.refresh only ships example refresh commands for Ubuntu/Debian Linux and Windows.
{% endif %}