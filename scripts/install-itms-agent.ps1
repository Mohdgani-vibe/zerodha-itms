param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [string]$Category = 'auto',
    [string]$AssignedToEmail,
    [string]$AssignedToName,
    [string]$EmployeeCode,
    [string]$DepartmentName,
    [string]$AssetTag,
    [string]$Name,
    [string]$Notes = 'Installed by ITMS bootstrap',
    [string]$SaltMaster,
    [string]$WazuhManager,
    [string]$WazuhGroup = 'default',
    [string]$OpenScapCommand,
    [int]$OpenScapScanHours = 24,
    [int]$RefreshHours = 6,
    [bool]$UseDetailedHardwareInventory = $true,
    [string]$CollectorUrl,
    [string]$SaltMinionUrl,
    [string]$WazuhPackageUrl = 'https://packages.wazuh.com/4.x/windows/wazuh-agent-4.8.2-1.msi',
    [string]$ClamWinPackageUrl = 'https://www.clamwin.com/content/download/clamwin-free-antivirus-installer.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
$InstallDir = 'C:\ProgramData\ITMS'
$CollectorTarget = Join-Path $InstallDir 'push-system-inventory.ps1'
$ConfigFile = Join-Path $InstallDir 'itms-agent.env'
$SaltConfigDir = 'C:\salt\conf\minion.d'
$ComplianceRunner = Join-Path $InstallDir 'run-compliance-scan.ps1'
$DefaultClamAvScanPaths = @('C:\Users', 'C:\ProgramData', 'C:\Temp')

function Write-Log {
    param([string]$Message)
    Write-Host ('[itms-bootstrap] ' + $Message)
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This installer must run from an elevated PowerShell session.'
    }
}

function Download-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $Url -OutFile $Path
}

function Prompt-IfEmpty {
    param(
        [string]$Value,
        [string]$Label
    )

    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    return (Read-Host -Prompt $Label).Trim()
}

function Get-ChocoExecutable {
    $command = Get-Command choco -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $defaultPath = 'C:\ProgramData\chocolatey\bin\choco.exe'
    if (Test-Path $defaultPath) {
        return $defaultPath
    }

    return $null
}

function Install-Chocolatey {
    $choco = Get-ChocoExecutable
    if ($choco) {
        return $choco
    }

    Write-Log 'Chocolatey not found. Installing Chocolatey bootstrap.'
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

    $choco = Get-ChocoExecutable
    if (-not $choco) {
        throw 'Chocolatey bootstrap completed but choco.exe was not found.'
    }

    return $choco
}

function Install-SaltMinion {
    if (Get-Service -Name salt-minion -ErrorAction SilentlyContinue) {
        return
    }

    $choco = Get-ChocoExecutable
    if ($choco) {
        & $choco install salt-minion -y --no-progress
        return
    }

    try {
        $choco = Install-Chocolatey
        & $choco install salt-minion -y --no-progress
        return
    } catch {
        if ([string]::IsNullOrWhiteSpace($SaltMinionUrl)) {
            throw 'Salt Minion installation failed through Chocolatey and no -SaltMinionUrl fallback was provided.'
        }
    }

    $package = Join-Path $InstallDir 'salt-minion-installer.exe'
    Download-File -Url $SaltMinionUrl -Path $package
    Start-Process -FilePath $package -ArgumentList '/S' -Wait
}

function Configure-SaltMinion {
    if ([string]::IsNullOrWhiteSpace($SaltMaster)) {
        Write-Log 'Salt Minion installed without a configured master. Pass -SaltMaster to bind it during bootstrap.'
        return
    }

    New-Item -ItemType Directory -Force -Path $SaltConfigDir | Out-Null
    Set-Content -Path (Join-Path $SaltConfigDir 'itms.conf') -Value ('master: ' + $SaltMaster) -Encoding ASCII
}

function Configure-WazuhAgent {
    if ([string]::IsNullOrWhiteSpace($WazuhManager)) {
        Write-Log 'Wazuh agent installed without a configured manager. Pass -WazuhManager to bind it during bootstrap.'
        return
    }

    $configPaths = @(
        'C:\Program Files (x86)\ossec-agent\ossec.conf',
        'C:\Program Files\ossec-agent\ossec.conf'
    )
    $configPath = $configPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $configPath) {
        Write-Log 'Wazuh agent config file not found after installation. Skipping manager rewrite.'
        return
    }

    [xml]$xml = Get-Content -Path $configPath
    $root = $xml.ossec_config
    if (-not $root) {
        throw 'Wazuh ossec.conf did not contain ossec_config root element.'
    }

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
    $address.InnerText = $WazuhManager

    if (-not [string]::IsNullOrWhiteSpace($WazuhGroup)) {
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
        $groups.InnerText = $WazuhGroup
    }

    $xml.Save($configPath)
}

function Install-WazuhAgent {
    $installed = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'Wazuh Agent*' }
    if ($installed) {
        return
    }

    $package = Join-Path $InstallDir 'wazuh-agent.msi'
    Download-File -Url $WazuhPackageUrl -Path $package

    $arguments = @('/i', ('"' + $package + '"'), '/qn')
    if (-not [string]::IsNullOrWhiteSpace($WazuhManager)) {
        $arguments += ('WAZUH_MANAGER=' + $WazuhManager)
        $arguments += ('WAZUH_AGENT_GROUP=' + $WazuhGroup)
    }

    Start-Process -FilePath msiexec.exe -ArgumentList $arguments -Wait

    if ([string]::IsNullOrWhiteSpace($WazuhManager)) {
        Write-Log 'Wazuh agent installed without a configured manager. Pass -WazuhManager to connect it during bootstrap.'
    }
}

function Install-ClamWin {
    $installed = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'ClamWin*' -or $_.DisplayName -like 'ClamAV*' }
    if ($installed) {
        return
    }

    $package = Join-Path $InstallDir 'clamwin-installer.exe'
    Download-File -Url $ClamWinPackageUrl -Path $package
    Start-Process -FilePath $package -ArgumentList '/S' -Wait
}

function Install-OpenScapNote {
    if ([string]::IsNullOrWhiteSpace($OpenScapCommand)) {
        Write-Log 'OpenSCAP has no standard Windows package. Pass -OpenScapCommand to schedule your approved Windows compliance scanner.'
        return
    }

    $runnerContent = @(
        '$ErrorActionPreference = ''Stop''',
        '$command = @''',
        $OpenScapCommand,
        '''@',
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command'
    )
    Set-Content -Path $ComplianceRunner -Value $runnerContent -Encoding ASCII

    schtasks /Create /TN 'ITMS Compliance Scan' /SC HOURLY /MO $OpenScapScanHours /RU SYSTEM /F /TR ('powershell.exe -ExecutionPolicy Bypass -File "' + $ComplianceRunner + '"') | Out-Null
    Write-Log 'Configured Windows compliance scan hook through ITMS Compliance Scan task.'
}

function Install-Collector {
    $localCollector = Join-Path $ScriptDir 'push-system-inventory.ps1'
    if (Test-Path $localCollector) {
        Copy-Item -Path $localCollector -Destination $CollectorTarget -Force
        return
    }

    if ([string]::IsNullOrWhiteSpace($CollectorUrl)) {
        $script:CollectorUrl = $ServerUrl.TrimEnd('/') + '/installers/push-system-inventory.ps1'
    }

    Download-File -Url $CollectorUrl -Path $CollectorTarget
}

function Write-Config {
    $lines = @(
        'ITMS_SERVER_URL=' + $ServerUrl,
        'ITMS_INGEST_TOKEN=' + $Token,
        'ITMS_ASSET_CATEGORY=' + $Category,
        'ITMS_ASSET_NOTES=' + $Notes
    )

    if (-not [string]::IsNullOrWhiteSpace($AssignedToEmail)) {
        $lines += 'ITMS_ASSIGNED_TO_EMAIL=' + $AssignedToEmail
    }
    if (-not [string]::IsNullOrWhiteSpace($AssignedToName)) {
        $lines += 'ITMS_ASSIGNED_TO_NAME=' + $AssignedToName
    }
    if (-not [string]::IsNullOrWhiteSpace($EmployeeCode)) {
        $lines += 'ITMS_EMPLOYEE_CODE=' + $EmployeeCode
    }
    if (-not [string]::IsNullOrWhiteSpace($DepartmentName)) {
        $lines += 'ITMS_DEPARTMENT_NAME=' + $DepartmentName
    }
    if (-not [string]::IsNullOrWhiteSpace($AssetTag)) {
        $lines += 'ITMS_ASSET_TAG=' + $AssetTag
    }
    if (-not [string]::IsNullOrWhiteSpace($Name)) {
        $lines += 'ITMS_ASSET_NAME=' + $Name
    }
    if (-not [string]::IsNullOrWhiteSpace($SaltMaster)) {
        $lines += 'ITMS_SALT_MASTER=' + $SaltMaster
    }
    if (-not [string]::IsNullOrWhiteSpace($WazuhManager)) {
        $lines += 'ITMS_WAZUH_MANAGER=' + $WazuhManager
    }
    if (-not [string]::IsNullOrWhiteSpace($WazuhGroup)) {
        $lines += 'ITMS_WAZUH_GROUP=' + $WazuhGroup
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenScapCommand)) {
        $lines += 'ITMS_OPENSCAP_COMMAND=' + $OpenScapCommand
    }
    $lines += 'ITMS_CLAMAV_SCAN_PATHS=' + ($DefaultClamAvScanPaths -join ',')
    $lines += 'ITMS_CLAMAV_TIMEOUT=7200'
    $lines += 'ITMS_USE_DETAILED_HARDWARE_INVENTORY=' + $UseDetailedHardwareInventory.ToString().ToLowerInvariant()

    Set-Content -Path $ConfigFile -Value $lines -Encoding ASCII
}

function Install-InventoryTask {
    $taskName = 'ITMS Inventory Refresh'
    $taskCommand = 'powershell.exe -ExecutionPolicy Bypass -File "' + $CollectorTarget + '" -ServerUrl "' + $ServerUrl + '" -Token "' + $Token + '" -Category "' + $Category + '"'
    $taskCommand += ' -UseDetailedHardwareInventory $' + $UseDetailedHardwareInventory.ToString().ToLowerInvariant()
    if (-not [string]::IsNullOrWhiteSpace($AssignedToEmail)) {
        $taskCommand += ' -AssignedToEmail "' + $AssignedToEmail + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($AssignedToName)) {
        $taskCommand += ' -AssignedToName "' + $AssignedToName + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($EmployeeCode)) {
        $taskCommand += ' -EmployeeCode "' + $EmployeeCode + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($DepartmentName)) {
        $taskCommand += ' -DepartmentName "' + $DepartmentName + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($AssetTag)) {
        $taskCommand += ' -AssetTag "' + $AssetTag + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($Name)) {
        $taskCommand += ' -Name "' + $Name + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($Notes)) {
        $taskCommand += ' -Notes "' + $Notes + '"'
    }

    schtasks /Create /TN $taskName /SC HOURLY /MO $RefreshHours /RU SYSTEM /F /TR $taskCommand | Out-Null
}

function Install-ClamAvTask {
    $taskName = 'ITMS ClamAV Scan'
    $taskCommand = 'powershell.exe -ExecutionPolicy Bypass -File "' + $CollectorTarget + '" -ServerUrl "' + $ServerUrl + '" -Token "' + $Token + '" -Category "' + $Category + '" -UseDetailedHardwareInventory $' + $UseDetailedHardwareInventory.ToString().ToLowerInvariant() + ' -IncludeClamAvReport'
    if (-not [string]::IsNullOrWhiteSpace($AssignedToEmail)) {
        $taskCommand += ' -AssignedToEmail "' + $AssignedToEmail + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($AssignedToName)) {
        $taskCommand += ' -AssignedToName "' + $AssignedToName + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($EmployeeCode)) {
        $taskCommand += ' -EmployeeCode "' + $EmployeeCode + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($DepartmentName)) {
        $taskCommand += ' -DepartmentName "' + $DepartmentName + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($AssetTag)) {
        $taskCommand += ' -AssetTag "' + $AssetTag + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($Name)) {
        $taskCommand += ' -Name "' + $Name + '"'
    }
    if (-not [string]::IsNullOrWhiteSpace($Notes)) {
        $taskCommand += ' -Notes "' + $Notes + '"'
    }

    schtasks /Create /TN $taskName /SC DAILY /ST 12:00 /RU SYSTEM /F /TR $taskCommand | Out-Null
}

function Invoke-InitialInventoryPush {
    $arguments = @(
        '-ExecutionPolicy', 'Bypass',
        '-File', $CollectorTarget,
        '-ServerUrl', $ServerUrl,
        '-Token', $Token,
        '-Category', $Category,
        '-UseDetailedHardwareInventory', $UseDetailedHardwareInventory.ToString().ToLowerInvariant()
    )
    if (-not [string]::IsNullOrWhiteSpace($AssignedToEmail)) {
        $arguments += @('-AssignedToEmail', $AssignedToEmail)
    }
    if (-not [string]::IsNullOrWhiteSpace($AssignedToName)) {
        $arguments += @('-AssignedToName', $AssignedToName)
    }
    if (-not [string]::IsNullOrWhiteSpace($EmployeeCode)) {
        $arguments += @('-EmployeeCode', $EmployeeCode)
    }
    if (-not [string]::IsNullOrWhiteSpace($DepartmentName)) {
        $arguments += @('-DepartmentName', $DepartmentName)
    }
    if (-not [string]::IsNullOrWhiteSpace($AssetTag)) {
        $arguments += @('-AssetTag', $AssetTag)
    }
    if (-not [string]::IsNullOrWhiteSpace($Name)) {
        $arguments += @('-Name', $Name)
    }
    if (-not [string]::IsNullOrWhiteSpace($Notes)) {
        $arguments += @('-Notes', $Notes)
    }

    & powershell.exe @arguments
}

function Main {
    if ($RefreshHours -lt 1) {
        throw '-RefreshHours must be a positive integer.'
    }
    if ($OpenScapScanHours -lt 1) {
        throw '-OpenScapScanHours must be a positive integer.'
    }

    Assert-Admin
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $script:AssignedToName = Prompt-IfEmpty -Value $AssignedToName -Label 'Employee name'
    $script:AssignedToEmail = Prompt-IfEmpty -Value $AssignedToEmail -Label 'Employee email'
    $script:EmployeeCode = Prompt-IfEmpty -Value $EmployeeCode -Label 'Employee ID'
    $script:DepartmentName = Prompt-IfEmpty -Value $DepartmentName -Label 'Employee department'

    Write-Log 'Installing Salt Minion'
    Install-SaltMinion
    Configure-SaltMinion

    Write-Log 'Installing Wazuh agent'
    Install-WazuhAgent
    Configure-WazuhAgent

    Write-Log 'Installing ClamWin'
    Install-ClamWin

    Install-OpenScapNote

    Write-Log 'Deploying ITMS collector and config'
    Install-Collector
    Write-Config

    Write-Log 'Ensuring services are running'
    Start-Service -Name salt-minion -ErrorAction SilentlyContinue
    Start-Service -Name WazuhSvc -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($SaltMaster)) {
        Restart-Service -Name salt-minion -ErrorAction SilentlyContinue
    }
    if (-not [string]::IsNullOrWhiteSpace($WazuhManager)) {
        Restart-Service -Name WazuhSvc -ErrorAction SilentlyContinue
    }

    Write-Log 'Creating inventory refresh task'
    Install-InventoryTask

    Write-Log 'Creating daily ClamAV scan task'
    Install-ClamAvTask

    Install-OpenScapNote

    Write-Log 'Pushing initial inventory snapshot'
    Invoke-InitialInventoryPush

    Write-Log 'Bootstrap complete'
}

Main