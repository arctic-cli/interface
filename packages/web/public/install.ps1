# Arctic PowerShell Installer for Windows
# Usage: irm https://arcticli.com/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$APP = "arctic"
$RequestedVersion = $env:VERSION
$RequestedTag = if ($env:TAG) { $env:TAG } else { "beta" }

# Colors
$MUTED = "`e[0;2m"
$RED = "`e[0;31m"
$ORANGE = "`e[38;5;214m"
$NC = "`e[0m"

# Detect architecture
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$OS = "windows"
$Target = "$OS-$Arch"
$FileName = "$APP-$Target.zip"
$PackageName = "$APP-$Target"

$NpmRegistryDefault = "https://registry.npmjs.org"
$NpmRegistry = if ($env:NPM_REGISTRY) { $env:NPM_REGISTRY } else { $NpmRegistryDefault }

function Write-Message {
    param(
        [string]$Level,
        [string]$Message
    )

    $Color = switch ($Level) {
        "info" { $NC }
        "warning" { $NC }
        "error" { $RED }
        default { $NC }
    }

    Write-Host "${Color}${Message}${NC}"
}

function Test-SemVer {
    param([string]$Version)
    return $Version -match '^\d+\.\d+\.\d+'
}

function Get-NpmTagVersion {
    param([string]$Tag)

    $MetaUrl = "$NpmRegistry/@arctic-cli%2F$PackageName"
    try {
        $Response = Invoke-RestMethod -Uri $MetaUrl -ErrorAction Stop
        return $Response.'dist-tags'.$Tag
    } catch {
        return $null
    }
}

# Resolve version
$SpecificVersion = $null
$ForceNpmDownload = $false
$Url = $null

if ($RequestedTag) {
    $SpecificVersion = Get-NpmTagVersion -Tag $RequestedTag
    if (-not $SpecificVersion) {
        Write-Message -Level "error" -Message "Failed to resolve npm dist-tag '$RequestedTag' for @arctic-cli/$PackageName."
        exit 1
    }
    $ForceNpmDownload = $true
} elseif ($RequestedVersion) {
    if (Test-SemVer -Version $RequestedVersion) {
        $Url = "https://github.com/arctic-cli/interface/releases/download/v$RequestedVersion/$FileName"
        $SpecificVersion = $RequestedVersion
    } else {
        $SpecificVersion = Get-NpmTagVersion -Tag $RequestedVersion
        if (-not $SpecificVersion) {
            Write-Message -Level "error" -Message "Failed to resolve npm dist-tag '$RequestedVersion' for @arctic-cli/$PackageName."
            exit 1
        }
        $ForceNpmDownload = $true
    }
} else {
    # Default to beta tag
    $SpecificVersion = Get-NpmTagVersion -Tag $RequestedTag
    if (-not $SpecificVersion) {
        Write-Message -Level "error" -Message "Failed to resolve npm dist-tag '$RequestedTag' for @arctic-cli/$PackageName."
        exit 1
    }
    $ForceNpmDownload = $true
}

# Check if already installed
if (Get-Command arctic -ErrorAction SilentlyContinue) {
    $InstalledVersion = (arctic --version 2>$null | Select-Object -First 1).Trim() -replace '^v', ''

    if ($InstalledVersion -ne $SpecificVersion) {
        Write-Message -Level "info" -Message "${MUTED}Installed version: ${NC}$InstalledVersion."
    } else {
        Write-Message -Level "info" -Message "${MUTED}Version ${NC}$SpecificVersion${MUTED} already installed"
        exit 0
    }
}

# Install directory
$InstallDir = Join-Path $env:USERPROFILE ".arctic\bin"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Message -Level "info" -Message "`n${MUTED}Installing ${NC}arctic ${MUTED}version: ${NC}$SpecificVersion"

# Create temp directory
$TempDir = Join-Path $env:TEMP "arctictmp_$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
Push-Location $TempDir

try {
    $DownloadedFile = $FileName

    if ($ForceNpmDownload) {
        Write-Message -Level "error" -Message "npm fallback is not supported on Windows. Please use GitHub releases."
        exit 1
    }

    # Download from GitHub releases
    Write-Host "${ORANGE}Downloading...${NC}"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $DownloadedFile -ErrorAction Stop
    } catch {
        Write-Message -Level "error" -Message "Failed to download Arctic binary from $Url"
        Write-Message -Level "error" -Message $_.Exception.Message
        exit 1
    }

    # Extract zip
    Write-Host "${ORANGE}Extracting...${NC}"
    Expand-Archive -Path $DownloadedFile -DestinationPath . -Force

    # Find binary
    $BinaryPath = $null
    $Candidates = @("arctic.exe", "bin\arctic.exe", "package\bin\arctic.exe")
    foreach ($Candidate in $Candidates) {
        if (Test-Path $Candidate) {
            $BinaryPath = $Candidate
            break
        }
    }

    if (-not $BinaryPath) {
        Write-Message -Level "error" -Message "Unable to locate Arctic binary inside the downloaded archive."
        exit 1
    }

    # Move to install directory
    $Destination = Join-Path $InstallDir (Split-Path $BinaryPath -Leaf)
    Move-Item -Path $BinaryPath -Destination $Destination -Force

} finally {
    Pop-Location
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Add to PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = "$InstallDir;$UserPath"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$InstallDir;$env:Path"
    Write-Message -Level "info" -Message "${MUTED}Successfully added ${NC}arctic ${MUTED}to `$PATH"
} else {
    Write-Message -Level "info" -Message "${MUTED}Arctic is already in `$PATH"
}

# Success message
Write-Host ""
Write-Host "${MUTED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
Write-Host ""
Write-Host "  ${NC}Arctic installed successfully!${NC}"
Write-Host ""
Write-Host "${MUTED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
Write-Host ""
Write-Host "  ${MUTED}Get started:${NC}"
Write-Host ""
Write-Host "  cd <project>  ${MUTED}# Open your project${NC}"
Write-Host "  arctic        ${MUTED}# Launch Arctic${NC}"
Write-Host ""
Write-Host "  ${MUTED}Docs: ${NC}https://arcticli.com/docs"
Write-Host ""
Write-Host "${ORANGE}⚠ Important: Restart your terminal for PATH changes to take effect${NC}"
Write-Host ""
