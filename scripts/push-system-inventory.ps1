param(
    [string]$ServerUrl = $env:ITMS_SERVER_URL,
    [string]$Token = $env:ITMS_INGEST_TOKEN,
    [string]$AssetTag = $env:ITMS_ASSET_TAG,
    [string]$Name = $env:ITMS_ASSET_NAME,
    [string]$Category = $(if ($env:ITMS_ASSET_CATEGORY) { $env:ITMS_ASSET_CATEGORY } else { 'auto' }),
    [string]$AssignedToEmail = $env:ITMS_ASSIGNED_TO_EMAIL,
    [string]$AssignedToName = $env:ITMS_ASSIGNED_TO_NAME,
    [string]$EmployeeCode = $env:ITMS_EMPLOYEE_CODE,
    [string]$DepartmentName = $env:ITMS_DEPARTMENT_NAME,
    [string]$EntityId = $env:ITMS_ENTITY_ID,
    [string]$DeptId = $env:ITMS_DEPT_ID,
    [string]$LocationId = $env:ITMS_LOCATION_ID,
    [string]$PurchaseDate = $env:ITMS_PURCHASE_DATE,
    [string]$WarrantyUntil = $env:ITMS_WARRANTY_UNTIL,
    [string]$Status = $(if ($env:ITMS_ASSET_STATUS) { $env:ITMS_ASSET_STATUS } else { 'in_use' }),
    [string]$Condition = $(if ($env:ITMS_ASSET_CONDITION) { $env:ITMS_ASSET_CONDITION } else { 'good' }),
    [string]$SaltMinionId = $env:ITMS_SALT_MINION_ID,
    [string]$WazuhAgentId = $env:ITMS_WAZUH_AGENT_ID,
    [string]$Notes = $(if ($env:ITMS_ASSET_NOTES) { $env:ITMS_ASSET_NOTES } else { $env:ITMS_NOTES }),
    [string]$SourceFingerprint = $env:ITMS_SOURCE_FINGERPRINT,
    [bool]$UseDetailedHardwareInventory = $true,
    [int]$SoftwareLimit = 200,
    [switch]$IncludeClamAvReport,
    [string[]]$ClamAvScanPaths,
    [int]$ClamAvTimeoutSeconds = 7200,
    [switch]$NoSoftwareScan,
    [switch]$PrintOnly,
    [int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ((-not $ClamAvScanPaths -or $ClamAvScanPaths.Count -eq 0) -and -not [string]::IsNullOrWhiteSpace($env:ITMS_CLAMAV_SCAN_PATHS)) {
    $ClamAvScanPaths = @($env:ITMS_CLAMAV_SCAN_PATHS -split '[,;]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
}
if (-not $ClamAvScanPaths -or $ClamAvScanPaths.Count -eq 0) {
    $ClamAvScanPaths = @('C:\Users', 'C:\ProgramData', 'C:\Temp')
}

function Format-Bytes {
    param([UInt64]$Bytes)

    if ($Bytes -le 0) {
        return 'Unknown'
    }

    $units = @('B', 'KB', 'MB', 'GB', 'TB', 'PB')
    $value = [double]$Bytes
    $unitIndex = 0
    while ($value -ge 1024 -and $unitIndex -lt ($units.Length - 1)) {
        $value = $value / 1024
        $unitIndex += 1
    }

    if ($value -ge 100 -or $unitIndex -eq 0) {
        return ('{0} {1}' -f [int][Math]::Round($value), $units[$unitIndex])
    }
    return ('{0:N1} {1}' -f $value, $units[$unitIndex])
}

function Normalize-Endpoint {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 'http://localhost:3001/api/inventory-sync/ingest'
    }

    if ($Value -notmatch '^[a-z]+://') {
        $Value = 'http://' + $Value
    }

    if ($Value.EndsWith('/api/inventory-sync/ingest')) {
        return $Value
    }

    return $Value.TrimEnd('/') + '/api/inventory-sync/ingest'
}

function Get-PendingUpdateCount {
    try {
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $result = $searcher.Search("IsInstalled=0 and Type='Software'")
        return [int]$result.Updates.Count
    } catch {
        return 0
    }
}

function Get-PrimaryMacAddress {
    try {
        $adapter = Get-NetAdapter -Physical -ErrorAction Stop |
            Where-Object { $_.Status -eq 'Up' -and -not [string]::IsNullOrWhiteSpace($_.MacAddress) } |
            Select-Object -First 1
        if ($null -ne $adapter -and -not [string]::IsNullOrWhiteSpace($adapter.MacAddress)) {
            return $adapter.MacAddress.Trim().ToLowerInvariant().Replace('-', ':')
        }
    } catch {
    }

    try {
        $adapter = Get-CimInstance Win32_NetworkAdapter -ErrorAction Stop |
            Where-Object { $_.PhysicalAdapter -and -not [string]::IsNullOrWhiteSpace($_.MACAddress) -and $_.NetEnabled } |
            Select-Object -First 1
        if ($null -ne $adapter -and -not [string]::IsNullOrWhiteSpace($adapter.MACAddress)) {
            return $adapter.MACAddress.Trim().ToLowerInvariant()
        }
    } catch {
    }

    return ''
}

function Get-GpuDescription {
    try {
        $names = Get-CimInstance Win32_VideoController -ErrorAction Stop |
            ForEach-Object { $_.Name } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Unique
        if ($names) {
            return (($names | ForEach-Object { $_.Trim() }) -join '; ')
        }
    } catch {
    }

    return ''
}

function Get-DisplayDescription {
    try {
        $descriptions = Get-CimInstance Win32_VideoController -ErrorAction Stop |
            ForEach-Object {
                if ($_.CurrentHorizontalResolution -and $_.CurrentVerticalResolution) {
                    '{0} {1}x{2}' -f $_.Name, $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution
                } elseif (-not [string]::IsNullOrWhiteSpace($_.VideoModeDescription)) {
                    '{0} {1}' -f $_.Name, $_.VideoModeDescription
                } else {
                    $null
                }
            } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Unique
        if ($descriptions) {
            return (($descriptions | ForEach-Object { $_.Trim() }) -join '; ')
        }
    } catch {
    }

    return ''
}

function Format-UtcTimestamp {
    param($Value)

    if ($null -eq $Value) {
        return ''
    }

    try {
        return ([DateTime]$Value).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    } catch {
        return ''
    }
}

function Get-InstalledSoftware {
    param([int]$Limit)

    $paths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    $apps = foreach ($path in $paths) {
        Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_.DisplayName) } |
            Select-Object @{Name='name';Expression={$_.DisplayName}}, @{Name='version';Expression={$_.DisplayVersion}}, @{Name='install_date';Expression={$_.InstallDate}}
    }

    $seen = @{}
    $results = @()
    foreach ($app in ($apps | Sort-Object name -Unique)) {
        if ($results.Count -ge $Limit) {
            break
        }
        if ($seen.ContainsKey($app.name)) {
            continue
        }
        $seen[$app.name] = $true
        $results += [ordered]@{
            name = $app.name
            version = $app.version
            install_date = $app.install_date
        }
    }
    return $results
}

function Get-ClamAvScannerPath {
    $command = Get-Command clamscan.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        'C:\Program Files\ClamWin\bin\clamscan.exe',
        'C:\Program Files (x86)\ClamWin\bin\clamscan.exe',
        'C:\Program Files\ClamAV\clamscan.exe',
        'C:\Program Files\ClamAV\clamdscan.exe'
    )

    return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Get-ParsedCount {
    param(
        [string]$Output,
        [string]$Label
    )

    $match = [regex]::Match($Output, ('(?im)^\s*' + [regex]::Escape($Label) + ':\s*(\d+)'))
    if ($match.Success) {
        return [int]$match.Groups[1].Value
    }
    return 0
}

function Get-ClamAvReport {
    $scanner = Get-ClamAvScannerPath
    if ([string]::IsNullOrWhiteSpace($scanner)) {
        return $null
    }

    $resolvedPaths = @($ClamAvScanPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path $_) })
    if (-not $resolvedPaths -or $resolvedPaths.Count -eq 0) {
        $resolvedPaths = @('C:\')
    }

    $arguments = @('--recursive', '--infected') + $resolvedPaths
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $process.StartInfo.FileName = $scanner
    $process.StartInfo.Arguments = [string]::Join(' ', ($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }))
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true

    [void]$process.Start()
    if (-not $process.WaitForExit($ClamAvTimeoutSeconds * 1000)) {
        try { $process.Kill() } catch {}
        return [ordered]@{
            source = 'clamav'
            status = 'error'
            severity = 'warning'
            title = 'ClamAV scan failed'
            summary = 'ClamAV scan timed out before completion.'
            detail = 'The ClamAV scheduled scan exceeded the configured timeout.'
            scanned_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
            scanned_paths = $resolvedPaths
            error_count = 1
        }
    }

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $output = (($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n"
    $infectedFiles = @()
    foreach ($line in ($output -split "`r?`n")) {
        if ($line.Trim().EndsWith(' FOUND') -and $line.Contains(':')) {
            $infectedFiles += ($line.Substring(0, $line.LastIndexOf(':')).Trim())
        }
    }

    $infectedCount = Get-ParsedCount -Output $output -Label 'Infected files'
    if ($infectedCount -eq 0 -and $infectedFiles.Count -gt 0) {
        $infectedCount = $infectedFiles.Count
    }
    $scannedCount = Get-ParsedCount -Output $output -Label 'Scanned files'
    $errorCount = Get-ParsedCount -Output $output -Label 'Total errors'

    $status = 'clean'
    $severity = 'info'
    $title = 'ClamAV scan clean'
    if ($process.ExitCode -eq 1 -or $infectedCount -gt 0) {
        $status = 'infected'
        $severity = 'high'
        $title = 'ClamAV detected threats'
    } elseif ($process.ExitCode -ne 0) {
        $status = 'error'
        $severity = 'warning'
        $title = 'ClamAV scan failed'
    }

    $detailLines = @($output -split "`r?`n" | Select-Object -Last 40)

    return [ordered]@{
        source = 'clamav'
        status = $status
        severity = $severity
        title = $title
        summary = ('Scanned {0} files; infected: {1}; errors: {2}.' -f $(if ($scannedCount -gt 0) { $scannedCount } else { 'unknown' }), $infectedCount, $errorCount)
        detail = ($detailLines -join "`n").Trim()
        scanned_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        scanned_paths = $resolvedPaths
        infected_files = @($infectedFiles | Select-Object -First 20)
        scanned_file_count = $scannedCount
        infected_file_count = $infectedCount
        error_count = $errorCount
    }
}

function Get-InferredCategory {
    param(
        [string]$RequestedCategory,
        [string]$Manufacturer,
        [string]$Model,
        [int]$PcSystemType
    )

    $normalized = ($RequestedCategory ?? '').Trim().ToLowerInvariant()
    if ($normalized -and $normalized -ne 'auto') {
        return $normalized
    }

    $combined = ($Manufacturer + ' ' + $Model).ToLowerInvariant()
    if ($combined -match 'virtual|vmware|virtualbox|hyper-v|kvm|qemu') {
        return 'vm'
    }

    if ($PcSystemType -eq 2) {
        return 'laptop'
    }

    return 'desktop'
}

function Get-DetectedSaltMinionId {
    $paths = @(
        'C:\salt\conf\minion_id',
        'C:\ProgramData\Salt Project\Salt\conf\minion_id'
    )

    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            $value = (Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value
            }
        }
    }

    return ''
}

function Get-DetectedWazuhAgentId {
    $paths = @(
        'C:\Program Files (x86)\ossec-agent\client.keys',
        'C:\Program Files\ossec-agent\client.keys'
    )

    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            $line = (Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }
            $parts = $line -split '\s+'
            if ($parts.Length -ge 2 -and -not [string]::IsNullOrWhiteSpace($parts[1])) {
                return $parts[1]
            }
        }
    }

    return ''
}

function Get-SourceFingerprint {
    if (-not [string]::IsNullOrWhiteSpace($SourceFingerprint)) {
        return $SourceFingerprint.Trim().ToLowerInvariant()
    }

    try {
        $machineGuid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name 'MachineGuid' -ErrorAction Stop).MachineGuid
        if (-not [string]::IsNullOrWhiteSpace($machineGuid)) {
            return $machineGuid.Trim().ToLowerInvariant()
        }
    } catch {
    }

    if (-not [string]::IsNullOrWhiteSpace($bios.SerialNumber)) {
        return $bios.SerialNumber.Trim().ToLowerInvariant()
    }

    return $env:COMPUTERNAME.Trim().ToLowerInvariant()
}

function Get-DefaultAssetTag {
    param(
        [string]$Hostname,
        [string]$Fingerprint
    )

    $hostnameKey = -join (($Hostname.ToUpperInvariant().ToCharArray() | Where-Object { [char]::IsLetterOrDigit($_) }))
    if ([string]::IsNullOrWhiteSpace($hostnameKey)) {
        $hostnameKey = 'SYSTEM'
    }

    $suffix = -join (($Fingerprint.ToUpperInvariant().ToCharArray() | Where-Object { [char]::IsLetterOrDigit($_) }))
    if ($suffix.Length -gt 8) {
        $suffix = $suffix.Substring(0, 8)
    }

    if ([string]::IsNullOrWhiteSpace($suffix)) {
        if ($hostnameKey.Length -gt 20) {
            return $hostnameKey.Substring(0, 20)
        }
        return $hostnameKey
    }

    $prefixLength = 20 - $suffix.Length - 1
    if ($prefixLength -lt 1) {
        $prefixLength = 1
    }
    if ($hostnameKey.Length -gt $prefixLength) {
        $hostnameKey = $hostnameKey.Substring(0, $prefixLength)
    }
    return $hostnameKey + '-' + $suffix
}

$computer = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$videoControllers = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue)
$memory = (Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum
$storage = (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Measure-Object -Property Size -Sum).Sum
$hostname = $env:COMPUTERNAME
$endpoint = Normalize-Endpoint -Value $ServerUrl
$resolvedCategory = Get-InferredCategory -RequestedCategory $Category -Manufacturer $computer.Manufacturer -Model $computer.Model -PcSystemType ([int]$computer.PCSystemType)
$resolvedSourceFingerprint = Get-SourceFingerprint

if ([string]::IsNullOrWhiteSpace($AssetTag)) {
    $AssetTag = Get-DefaultAssetTag -Hostname $hostname -Fingerprint $resolvedSourceFingerprint
}
if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = $hostname
}
if ([string]::IsNullOrWhiteSpace($SaltMinionId)) {
    $SaltMinionId = Get-DetectedSaltMinionId
}
if ([string]::IsNullOrWhiteSpace($WazuhAgentId)) {
    $WazuhAgentId = Get-DetectedWazuhAgentId
}

$securityReports = @()
if ($IncludeClamAvReport) {
    $clamAvReport = Get-ClamAvReport
    if ($clamAvReport) {
        $securityReports += $clamAvReport
    }
}

$payload = [ordered]@{
    assets = @(
        [ordered]@{
            asset_tag = $AssetTag
            name = $Name
            hostname = $hostname
            category = $resolvedCategory
            is_compute = $true
            serial_number = $bios.SerialNumber
            manufacturer = $computer.Manufacturer
            model = $computer.Model
            entity_id = $EntityId
            dept_id = $DeptId
            location_id = $LocationId
            assigned_to_email = $AssignedToEmail
            assigned_to_name = $AssignedToName
            employee_code = $EmployeeCode
            department_name = $DepartmentName
            purchase_date = $PurchaseDate
            warranty_until = $WarrantyUntil
            status = $Status
            condition = $Condition
            source_fingerprint = $resolvedSourceFingerprint
            salt_minion_id = $SaltMinionId
            wazuh_agent_id = $WazuhAgentId
            notes = $Notes
            compute_details = [ordered]@{
                processor = $processor.Name
                ram = (Format-Bytes -Bytes ([UInt64]$memory))
                storage = (Format-Bytes -Bytes ([UInt64]$storage))
                gpu = $(if ($UseDetailedHardwareInventory) { Get-GpuDescription } else { '' })
                display = $(if ($UseDetailedHardwareInventory) { Get-DisplayDescription } else { '' })
                bios_version = $bios.SMBIOSBIOSVersion
                mac_address = $(if ($UseDetailedHardwareInventory) { Get-PrimaryMacAddress } else { '' })
                os_name = $operatingSystem.Caption
                os_version = $operatingSystem.Version
                kernel = $operatingSystem.BuildNumber
                architecture = $operatingSystem.OSArchitecture
                os_build = $operatingSystem.BuildNumber
                last_boot = $(if ($UseDetailedHardwareInventory) { Format-UtcTimestamp -Value $operatingSystem.LastBootUpTime } else { '' })
                last_seen = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                pending_updates = (Get-PendingUpdateCount)
            }
            installed_software = $(if ($NoSoftwareScan) { @() } else { Get-InstalledSoftware -Limit $SoftwareLimit })
            security_reports = $securityReports
        }
    )
}

if ($PrintOnly) {
    $payload | ConvertTo-Json -Depth 8
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error 'ITMS ingest token is required. Set --Token or ITMS_INGEST_TOKEN.'
    exit 1
}

$json = $payload | ConvertTo-Json -Depth 8
$headers = @{ Authorization = ('Bearer ' + $Token) }

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Headers $headers -Body $json -TimeoutSec $TimeoutSeconds
    $response | ConvertTo-Json -Depth 8
} catch {
    Write-Error $_
    exit 1
}