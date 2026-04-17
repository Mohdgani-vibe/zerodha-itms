#!/usr/bin/env python3

import argparse
import datetime
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path


def run_command(command, timeout=15):
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0 and not result.stdout:
        return ""
    return result.stdout.strip()


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""


def env_flag(name):
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def env_list(name):
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    values = []
    for part in raw.replace(";", ",").split(","):
        value = part.strip()
        if value:
            values.append(value)
    return values


def command_exists(name):
    return shutil.which(name) is not None


def parse_summary_count(value):
    if not value:
        return 0
    first_token = value.split()[0].strip()
    return int(first_token) if first_token.isdigit() else 0


def parse_os_release():
    values = {}
    for line in read_text("/etc/os-release").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def format_bytes(size_bytes):
    if size_bytes <= 0:
        return "Unknown"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    value = float(size_bytes)
    unit_index = 0
    while value >= 1024 and unit_index < len(units) - 1:
        value /= 1024
        unit_index += 1
    if value >= 100 or unit_index == 0:
        return f"{int(round(value))} {units[unit_index]}"
    return f"{value:.1f} {units[unit_index]}"


def collect_processor():
    for line in read_text("/proc/cpuinfo").splitlines():
        if line.lower().startswith("model name"):
            return line.split(":", 1)[1].strip()
    output = run_command(["lscpu"])
    for line in output.splitlines():
        if line.lower().startswith("model name:"):
            return line.split(":", 1)[1].strip()
    return platform.processor() or "Unknown CPU"


def collect_memory():
    for line in read_text("/proc/meminfo").splitlines():
        if line.startswith("MemTotal:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return format_bytes(int(parts[1]) * 1024)
    return "Unknown RAM"


def collect_storage():
    output = run_command(["lsblk", "-b", "-dn", "-o", "SIZE,TYPE"])
    total = 0
    for line in output.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        size, device_type = parts
        if device_type != "disk" or not size.isdigit():
            continue
        total += int(size)
    if total == 0:
        return "Unknown storage"
    return format_bytes(total)


def collect_gpu():
    if not command_exists("lspci"):
        return ""
    devices = []
    for line in run_command(["lspci"]).splitlines():
        normalized = line.lower()
        if "vga compatible controller" not in normalized and "3d controller" not in normalized and "display controller" not in normalized:
            continue
        label = line.split(": ", 1)[1].strip() if ": " in line else line.strip()
        if label and label not in devices:
            devices.append(label)
    return "; ".join(devices)


@lru_cache(maxsize=1)
def collect_hardinfo_report():
    if not command_exists("hardinfo"):
        return ""
    return run_command(["hardinfo", "-r"], timeout=30)


def collect_display(use_hardinfo_fallback=False):
    display_name = os.getenv("DISPLAY", "").strip()
    if display_name and command_exists("xrandr"):
        connected = []
        for line in run_command(["xrandr", "--current"]).splitlines():
            if " connected" not in line:
                continue
            parts = line.split()
            if not parts:
                continue
            output_name = parts[0]
            resolution = ""
            for part in parts[1:]:
                if "x" in part and "+" in part:
                    resolution = part.split("+", 1)[0]
                    break
            connected.append(f"{output_name} {resolution}".strip())
        if connected:
            return "; ".join(connected)

    if not use_hardinfo_fallback:
        return ""

    resolution = ""
    renderer = ""
    for line in collect_hardinfo_report().splitlines():
        stripped = line.strip()
        if stripped.startswith("Resolution") and ":" in stripped:
            resolution = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("OpenGL Renderer") and ":" in stripped:
            renderer = stripped.split(":", 1)[1].strip()
    details = []
    if resolution and resolution != "0x0 pixels":
        details.append(resolution)
    if renderer and renderer != "(Unknown)":
        details.append(renderer)
    return "; ".join(details)


def collect_primary_mac_address():
    if not command_exists("ip"):
        return ""
    primary = ""
    fallback = ""
    virtual_prefixes = ("docker", "br-", "veth", "virbr", "lo", "tun", "tap", "wg")
    for line in run_command(["ip", "-o", "link", "show"]).splitlines():
        if "link/ether" not in line:
            continue
        parts = line.split(": ", 2)
        if len(parts) < 2:
            continue
        interface_name = parts[1].split("@", 1)[0].strip()
        mac_address = line.split("link/ether", 1)[1].strip().split()[0].lower()
        if not fallback:
            fallback = mac_address
        if interface_name.startswith(virtual_prefixes):
            continue
        primary = mac_address
        break
    return primary or fallback


def collect_last_boot():
    value = run_command(["bash", "-lc", "date -u -d \"$(uptime -s)\" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null"])
    if value:
        return value

    boot_line = run_command(["who", "-b"])
    if not boot_line:
        return ""
    text = boot_line.split("system boot", 1)[-1].strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d %H:%M", "%b %d %H:%M"):
        try:
            parsed = datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
        if fmt == "%b %d %H:%M":
            parsed = parsed.replace(year=datetime.datetime.utcnow().year)
        return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")
    return ""


def collect_serial_number():
    return read_text("/sys/class/dmi/id/product_serial") or read_text("/sys/devices/virtual/dmi/id/product_serial") or ""


def collect_manufacturer():
    return read_text("/sys/class/dmi/id/sys_vendor") or ""


def collect_model():
    return read_text("/sys/class/dmi/id/product_name") or ""


def collect_source_fingerprint():
    for candidate in (
        "/etc/machine-id",
        "/var/lib/dbus/machine-id",
        "/sys/class/dmi/id/product_uuid",
        "/sys/class/dmi/id/product_serial",
    ):
        value = read_text(candidate).strip().lower()
        if value:
            return value
    return socket.gethostname().split(".", 1)[0].strip().lower()


def build_default_asset_tag(hostname, source_fingerprint):
    hostname_key = "".join(ch for ch in hostname.upper() if ch.isalnum()) or "SYSTEM"
    suffix = "".join(ch for ch in source_fingerprint.upper() if ch.isalnum())[:8]
    if not suffix:
        return hostname_key[:20]
    prefix_length = max(1, 20 - len(suffix) - 1)
    return f"{hostname_key[:prefix_length]}-{suffix}"


def collect_salt_minion_id():
    minion_id = read_text("/etc/salt/minion_id")
    if minion_id:
        return minion_id
    if not run_command(["bash", "-lc", "command -v salt-call >/dev/null 2>&1 && echo yes"]):
        return ""
    detected = run_command(["bash", "-lc", "salt-call --local grains.get id --out=newline_values_only 2>/dev/null | tail -n 1"])
    return detected.strip()


def collect_wazuh_agent_id():
    for path in ["/var/ossec/etc/client.keys", "/Library/Ossec/etc/client.keys"]:
        content = read_text(path)
        if not content:
            continue
        first_line = content.splitlines()[0].strip()
        if not first_line:
            continue
        parts = first_line.split()
        if len(parts) >= 2:
            return parts[1].strip()
    return ""


def read_chassis_type():
    value = read_text("/sys/class/dmi/id/chassis_type") or read_text("/sys/devices/virtual/dmi/id/chassis_type")
    return value.strip()


def infer_asset_category(requested_category, manufacturer, model):
    normalized = (requested_category or "").strip().lower()
    if normalized and normalized != "auto":
        return normalized

    virtualization = run_command(["systemd-detect-virt"])
    model_text = f"{manufacturer} {model}".lower()
    virtual_markers = ["virtualbox", "vmware", "kvm", "qemu", "hyper-v", "virtual machine", "bochs"]
    if virtualization and virtualization != "none":
        return "vm"
    if any(marker in model_text for marker in virtual_markers):
        return "vm"

    chassis_type = read_chassis_type()
    if chassis_type in {"8", "9", "10", "14"}:
        return "laptop"

    return "desktop"


def collect_bios_version():
    return read_text("/sys/class/dmi/id/bios_version") or ""


def collect_os_details():
    os_release = parse_os_release()
    os_name = os_release.get("PRETTY_NAME") or f"{platform.system()} {platform.release()}".strip()
    os_version = os_release.get("VERSION_ID") or platform.release()
    kernel = platform.release()
    architecture = platform.machine() or "unknown"
    os_build = platform.version()
    return os_name, os_version, kernel, architecture, os_build


def collect_pending_updates():
    apt_output = run_command(["bash", "-lc", "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l"])
    if apt_output.isdigit():
        return int(apt_output)

    dnf_output = run_command(["bash", "-lc", "dnf -q check-update 2>/dev/null | grep -Ec '^[A-Za-z0-9_.+-]+'"]) 
    if dnf_output.isdigit():
        return int(dnf_output)

    yum_output = run_command(["bash", "-lc", "yum -q check-update 2>/dev/null | grep -Ec '^[A-Za-z0-9_.+-]+'"]) 
    if yum_output.isdigit():
        return int(yum_output)

    return 0


def collect_installed_software(limit):
    software = []

    dpkg_output = run_command(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\n"])
    if dpkg_output:
        for line in dpkg_output.splitlines()[:limit]:
            parts = line.split("\t", 1)
            if not parts or not parts[0].strip():
                continue
            software.append({
                "name": parts[0].strip(),
                "version": parts[1].strip() if len(parts) > 1 else "",
                "install_date": "",
            })
        return software

    rpm_output = run_command(["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"])
    if rpm_output:
        for line in rpm_output.splitlines()[:limit]:
            parts = line.split("\t", 1)
            if not parts or not parts[0].strip():
                continue
            software.append({
                "name": parts[0].strip(),
                "version": parts[1].strip() if len(parts) > 1 else "",
                "install_date": "",
            })
    return software


def collect_clamav_report(scan_paths, timeout):
    scanner = shutil.which("clamscan") or shutil.which("clamdscan")
    if not scanner:
        return None

    resolved_paths = []
    for path in scan_paths:
        if not path:
            continue
        candidate = Path(path)
        if candidate.exists():
            resolved_paths.append(str(candidate))
    if not resolved_paths:
        resolved_paths = ["/"]

    command = [scanner, "--recursive", "--infected", *resolved_paths]
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {
            "source": "clamav",
            "status": "error",
            "severity": "warning",
            "title": "ClamAV scan failed",
            "summary": f"ClamAV scan failed before completion: {error}",
            "detail": str(error),
            "scanned_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "scanned_paths": resolved_paths,
            "error_count": 1,
        }

    output_parts = [part for part in [result.stdout.strip(), result.stderr.strip()] if part]
    output = "\n".join(output_parts)
    infected_files = []
    summary = {}
    in_summary = False
    for line in output.splitlines():
        stripped = line.strip()
        if stripped == "----------- SCAN SUMMARY -----------":
            in_summary = True
            continue
        if in_summary:
            if ":" not in stripped:
                continue
            key, value = stripped.split(":", 1)
            summary[key.strip().lower()] = value.strip()
            continue
        if stripped.endswith(" FOUND") and ":" in stripped:
            infected_files.append(stripped.rsplit(":", 1)[0].strip())

    infected_count = parse_summary_count(summary.get("infected files", "")) or len(infected_files)
    scanned_count = parse_summary_count(summary.get("scanned files", ""))
    error_count = parse_summary_count(summary.get("total errors", ""))

    status = "clean"
    severity = "info"
    title = "ClamAV scan clean"
    if result.returncode == 1 or infected_count > 0:
        status = "infected"
        severity = "high"
        title = "ClamAV detected threats"
    elif result.returncode not in (0, 1):
        status = "error"
        severity = "warning"
        title = "ClamAV scan failed"

    summary_text = f"Scanned {scanned_count or 'unknown'} files; infected: {infected_count}; errors: {error_count}."
    detail_lines = []
    if output:
        detail_lines = output.splitlines()[-40:]

    return {
        "source": "clamav",
        "status": status,
        "severity": severity,
        "title": title,
        "summary": summary_text,
        "detail": "\n".join(detail_lines),
        "scanned_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "scanned_paths": resolved_paths,
        "infected_files": infected_files[:20],
        "scanned_file_count": scanned_count,
        "infected_file_count": infected_count,
        "error_count": error_count,
    }


def find_latest_openscap_result(results_dir):
    if not results_dir:
        return None
    base_dir = Path(results_dir)
    if not base_dir.exists():
        return None
    candidates = sorted(base_dir.glob("openscap-results-*.xml"), key=lambda path: path.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def local_name(tag):
    return tag.split("}", 1)[1] if tag.startswith("{") and "}" in tag else tag


def openscap_rule_result(element):
    result = element.attrib.get("result", "").strip().lower()
    if result:
        return result

    for child in element:
        if local_name(child.tag) != "result":
            continue
        text = (child.text or "").strip().lower()
        if text:
            return text

    return "unknown"


def collect_openscap_report(results_dir):
    latest_result = find_latest_openscap_result(results_dir)
    if latest_result is None:
        return None

    try:
        tree = ET.parse(latest_result)
        root = tree.getroot()
    except (ET.ParseError, OSError) as error:
        return {
            "source": "openscap",
            "status": "error",
            "severity": "warning",
            "title": "OpenSCAP hardening report unavailable",
            "summary": f"Failed to parse OpenSCAP result file {latest_result.name}.",
            "detail": str(error),
            "scanned_at": datetime.datetime.fromtimestamp(latest_result.stat().st_mtime, tz=datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }

    benchmark_title = ""
    title_map = {}
    for element in root.iter():
        name = local_name(element.tag)
        if name == "Benchmark" and not benchmark_title:
            title_node = next((child for child in element if local_name(child.tag) == "title" and (child.text or "").strip()), None)
            if title_node is not None:
                benchmark_title = (title_node.text or "").strip()
        if name == "Rule":
            rule_id = element.attrib.get("id", "").strip()
            title_node = next((child for child in element if local_name(child.tag) == "title" and (child.text or "").strip()), None)
            if rule_id and title_node is not None:
                title_map[rule_id] = (title_node.text or "").strip()

    counts = {}
    failed_rules = []
    for element in root.iter():
        if local_name(element.tag) != "rule-result":
            continue
        result = openscap_rule_result(element)
        counts[result] = counts.get(result, 0) + 1
        if result not in {"fail", "error", "unknown"}:
            continue
        rule_id = element.attrib.get("idref", "").strip()
        rule_title = title_map.get(rule_id, "")
        failed_rules.append(f"{rule_id}: {rule_title}".strip(": "))

    fail_count = counts.get("fail", 0)
    error_count = counts.get("error", 0)
    pass_count = counts.get("pass", 0)
    informational_count = counts.get("informational", 0)
    notapplicable_count = counts.get("notapplicable", 0)
    notchecked_count = counts.get("notchecked", 0)
    fixed_count = counts.get("fixed", 0)
    total_rules = sum(counts.values())
    status = "compliant"
    severity = "info"
    title = "OpenSCAP hardening check passed"
    if fail_count > 0:
        status = "noncompliant"
        severity = "medium"
        title = "OpenSCAP hardening findings"
    elif error_count > 0:
        status = "error"
        severity = "warning"
        title = "OpenSCAP hardening scan failed"

    summary = (
        f"Rules checked: {total_rules}; passed: {pass_count}; failed: {fail_count}; errors: {error_count}; "
        f"not-applicable: {notapplicable_count}; informational: {informational_count}; not-checked: {notchecked_count}; fixed: {fixed_count}."
    )
    detail_lines = []
    if benchmark_title:
        detail_lines.append(benchmark_title)
    detail_lines.append(summary)
    if failed_rules:
        detail_lines.append("Top failed rules:")
        detail_lines.extend(f"- {item}" for item in failed_rules[:20])

    report_file = latest_result.with_name(latest_result.name.replace("results", "report").replace(".xml", ".html"))
    scanned_at = datetime.datetime.fromtimestamp(latest_result.stat().st_mtime, tz=datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "source": "openscap",
        "status": status,
        "severity": severity,
        "title": title,
        "summary": summary,
        "detail": "\n".join(detail_lines),
        "scanned_at": scanned_at,
        "scanned_paths": [str(results_dir)],
        "scanned_file_count": total_rules,
        "infected_file_count": fail_count,
        "error_count": error_count,
        "artifact_files": [str(latest_result)] + ([str(report_file)] if report_file.exists() else []),
    }


def normalize_endpoint(server_url):
    parsed = urllib.parse.urlparse(server_url)
    if not parsed.scheme:
        server_url = f"http://{server_url}"
        parsed = urllib.parse.urlparse(server_url)

    if parsed.path.endswith("/api/inventory-sync/ingest"):
        return server_url

    base_path = parsed.path.rstrip("/")
    endpoint_path = f"{base_path}/api/inventory-sync/ingest" if base_path else "/api/inventory-sync/ingest"
    normalized = parsed._replace(path=endpoint_path, params="", query="", fragment="")
    return urllib.parse.urlunparse(normalized)


def build_asset_payload(args):
    hostname = socket.gethostname().split(".", 1)[0]
    os_name, os_version, kernel, architecture, os_build = collect_os_details()
    source_fingerprint = args.source_fingerprint or collect_source_fingerprint()
    asset_tag = args.asset_tag or build_default_asset_tag(hostname, source_fingerprint)
    manufacturer = collect_manufacturer()
    model = collect_model()
    serial_number = collect_serial_number()
    category = infer_asset_category(args.category, manufacturer, model)
    salt_minion_id = args.salt_minion_id or collect_salt_minion_id()
    wazuh_agent_id = args.wazuh_agent_id or collect_wazuh_agent_id()
    asset_payload = {
        "asset_tag": asset_tag,
        "name": args.name or hostname,
        "hostname": hostname,
        "category": category,
        "is_compute": True,
        "serial_number": serial_number,
        "manufacturer": manufacturer,
        "model": model,
        "entity_id": args.entity_id,
        "dept_id": args.dept_id,
        "location_id": args.location_id,
        "assigned_to_email": args.assigned_to_email,
        "assigned_to_name": args.assigned_to_name,
        "employee_code": args.employee_code,
        "department_name": args.department_name,
        "purchase_date": args.purchase_date,
        "warranty_until": args.warranty_until,
        "status": args.status,
        "condition": args.condition,
        "source_fingerprint": source_fingerprint,
        "salt_minion_id": salt_minion_id,
        "wazuh_agent_id": wazuh_agent_id,
        "notes": args.notes,
        "compute_details": {
            "processor": collect_processor(),
            "ram": collect_memory(),
            "storage": collect_storage(),
            "gpu": collect_gpu(),
            "display": collect_display(args.use_hardinfo_fallback),
            "bios_version": collect_bios_version(),
            "mac_address": collect_primary_mac_address(),
            "os_name": os_name,
            "os_version": os_version,
            "kernel": kernel,
            "architecture": architecture,
            "os_build": os_build,
            "last_boot": collect_last_boot(),
            "last_seen": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "pending_updates": collect_pending_updates(),
        },
        "installed_software": [] if args.no_software_scan else collect_installed_software(args.software_limit),
    }
    security_reports = []
    if args.include_clamav_report:
        clamav_report = collect_clamav_report(args.clamav_scan_paths, args.clamav_timeout)
        if clamav_report:
            security_reports.append(clamav_report)
    if args.include_openscap_report:
        openscap_report = collect_openscap_report(args.openscap_results_dir)
        if openscap_report:
            security_reports.append(openscap_report)
    if security_reports:
        asset_payload["security_reports"] = security_reports

    payload = {
        "assets": [
            asset_payload
        ]
    }
    return payload


def post_payload(endpoint, token, payload, timeout):
    data = json.dumps(payload).encode("utf-8")
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(
            endpoint,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == max_attempts:
                raise
        except urllib.error.URLError:
            if attempt == max_attempts:
                raise

        time.sleep(min(2 ** (attempt - 1), 4))


def parse_args():
    parser = argparse.ArgumentParser(description="Collect hardware and OS details from a Linux system and push them to the ITMS backend.")
    parser.add_argument("--server-url", default=os.getenv("ITMS_SERVER_URL", "http://localhost:3001"), help="Backend base URL or full ingest endpoint")
    parser.add_argument("--token", default=os.getenv("ITMS_INGEST_TOKEN", ""), help="Inventory ingest token configured on the backend")
    parser.add_argument("--asset-tag", default=os.getenv("ITMS_ASSET_TAG", ""), help="Asset tag to report. Defaults to hostname plus a stable device suffix")
    parser.add_argument("--name", default=os.getenv("ITMS_ASSET_NAME", ""), help="Friendly asset name. Defaults to hostname")
    parser.add_argument("--category", default=os.getenv("ITMS_ASSET_CATEGORY", "auto"), help="Asset category such as auto, laptop, desktop, vm, or server")
    parser.add_argument("--assigned-to-email", default=os.getenv("ITMS_ASSIGNED_TO_EMAIL", ""), help="Employee email to link the asset to")
    parser.add_argument("--assigned-to-name", default=os.getenv("ITMS_ASSIGNED_TO_NAME", ""), help="Employee name for enrollment review")
    parser.add_argument("--employee-code", default=os.getenv("ITMS_EMPLOYEE_CODE", ""), help="Employee ID for enrollment review")
    parser.add_argument("--department-name", default=os.getenv("ITMS_DEPARTMENT_NAME", ""), help="Department name for enrollment review")
    parser.add_argument("--entity-id", default=os.getenv("ITMS_ENTITY_ID", ""), help="Optional entity UUID")
    parser.add_argument("--dept-id", default=os.getenv("ITMS_DEPT_ID", ""), help="Optional department UUID")
    parser.add_argument("--location-id", default=os.getenv("ITMS_LOCATION_ID", ""), help="Optional location UUID")
    parser.add_argument("--purchase-date", default=os.getenv("ITMS_PURCHASE_DATE", ""), help="Optional purchase date in YYYY-MM-DD")
    parser.add_argument("--warranty-until", default=os.getenv("ITMS_WARRANTY_UNTIL", ""), help="Optional warranty date in YYYY-MM-DD")
    parser.add_argument("--status", default=os.getenv("ITMS_ASSET_STATUS", "in_use"), help="Asset status to report")
    parser.add_argument("--condition", default=os.getenv("ITMS_ASSET_CONDITION", "good"), help="Asset condition to report")
    parser.add_argument("--source-fingerprint", default=os.getenv("ITMS_SOURCE_FINGERPRINT", ""), help="Stable device fingerprint. Defaults to machine-id or hardware UUID")
    parser.add_argument("--salt-minion-id", default=os.getenv("ITMS_SALT_MINION_ID", ""), help="Optional Salt minion ID override")
    parser.add_argument("--wazuh-agent-id", default=os.getenv("ITMS_WAZUH_AGENT_ID", ""), help="Optional Wazuh agent ID")
    parser.add_argument("--notes", default=os.getenv("ITMS_ASSET_NOTES", "Imported from system collector"), help="Freeform asset notes")
    parser.add_argument("--software-limit", type=int, default=int(os.getenv("ITMS_SOFTWARE_LIMIT", "200")), help="Maximum number of installed packages to include")
    parser.add_argument("--no-software-scan", action="store_true", help="Skip installed software collection")
    parser.add_argument("--include-clamav-report", action="store_true", default=env_flag("ITMS_INCLUDE_CLAMAV_REPORT"), help="Run a ClamAV scan and include the report in the payload")
    parser.add_argument("--clamav-scan-path", action="append", dest="clamav_scan_paths", default=env_list("ITMS_CLAMAV_SCAN_PATHS"), help="Path to include in the ClamAV scan. Can be passed multiple times")
    parser.add_argument("--clamav-timeout", type=int, default=int(os.getenv("ITMS_CLAMAV_TIMEOUT", "3600")), help="Maximum ClamAV scan runtime in seconds")
    parser.add_argument("--include-openscap-report", action="store_true", default=env_flag("ITMS_INCLUDE_OPENSCAP_REPORT"), help="Attach the latest OpenSCAP result summary from the configured results directory")
    parser.add_argument("--openscap-results-dir", default=os.getenv("ITMS_OPENSCAP_RESULTS_DIR", "/var/lib/itms/openscap"), help="Directory containing OpenSCAP result files")
    parser.add_argument("--use-hardinfo-fallback", action="store_true", default=env_flag("ITMS_USE_HARDINFO_FALLBACK"), help="Use hardinfo report parsing as a fallback for display details when available")
    parser.add_argument("--print-only", action="store_true", help="Print JSON payload instead of sending it")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")
    return parser.parse_args()


def main():
    args = parse_args()
    payload = build_asset_payload(args)

    if args.print_only:
        json.dump(payload, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not args.token:
        sys.stderr.write("Missing ingest token. Set --token or ITMS_INGEST_TOKEN.\n")
        return 1

    endpoint = normalize_endpoint(args.server_url)
    try:
        status_code, response_body = post_payload(endpoint, args.token, payload, args.timeout)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        sys.stderr.write(f"Inventory push failed with HTTP {error.code}: {body}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Inventory push failed: {error}\n")
        return 1

    sys.stdout.write(f"Inventory push succeeded with HTTP {status_code}.\n")
    if response_body:
        try:
            parsed = json.loads(response_body)
            json.dump(parsed, sys.stdout, indent=2)
            sys.stdout.write("\n")
        except json.JSONDecodeError:
            sys.stdout.write(response_body + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())