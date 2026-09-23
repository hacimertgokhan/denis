<#
.SYNOPSIS
  Denis Database installer for Windows.

.DESCRIPTION
  irm https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.ps1 | iex
  .\install.ps1                  (from an extracted release bundle: installs that bundle)

  Environment variables: DENIS_VERSION (default latest), DENIS_INSTALL (default %LOCALAPPDATA%\Denis),
  DENIS_PROFILE (default|small|server), DENIS_BIND (0.0.0.0 to accept remote clients).
#>
$ErrorActionPreference = 'Stop'
$repo = 'hacimertgokhan/denis'
$installDir = if ($env:DENIS_INSTALL) { $env:DENIS_INSTALL } else { Join-Path $env:LOCALAPPDATA 'Denis' }

function Fail($message) { Write-Host "error: $message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- Java 17+
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'java' }
try {
    $versionLine = (& $java -version 2>&1 | Select-Object -First 1).ToString()
} catch {
    Write-Host 'Denis needs Java 17 or newer, which was not found. Install it with:'
    Write-Host '  winget install EclipseAdoptium.Temurin.17.JRE'
    Write-Host '  or download it from https://adoptium.net'
    exit 1
}
if ($versionLine -match '"(\d+)(\.(\d+))?') {
    $major = [int]$Matches[1]
    if ($major -eq 1) { $major = [int]$Matches[3] }
    if ($major -lt 17) { Fail "Java 17 or newer is required, found: $versionLine" }
}

# ---------------------------------------------------------------- bundle
$sourceDir = if ($PSScriptRoot) { $PSScriptRoot } else { '' }
$tmp = $null
if ($sourceDir -and (Get-ChildItem -Path $sourceDir -Filter 'denis-*.jar' -ErrorAction SilentlyContinue)) {
    $bundle = $sourceDir
    Write-Host "Installing the bundle in $bundle"
} else {
    if ($env:DENIS_VERSION) {
        $tag = 'v' + $env:DENIS_VERSION.TrimStart('v')
    } else {
        $tag = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest").tag_name
    }
    $version = $tag.TrimStart('v')
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("denis-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $tmp 'denis.zip'
    $url = "https://github.com/$repo/releases/download/$tag/denis-$version-project-bundle.zip"
    Write-Host "Downloading Denis $version"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    try {
        $expected = ((Invoke-WebRequest -Uri "$url.sha256" -UseBasicParsing).Content -split ' ')[0].Trim()
        $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
        if ($expected -and ($expected -ne $actual)) { Fail 'checksum mismatch for the downloaded bundle' }
        Write-Host 'Checksum verified'
    } catch [System.Net.WebException] { }
    $bundle = Join-Path $tmp 'bundle'
    Expand-Archive -Path $zip -DestinationPath $bundle
}

# ---------------------------------------------------------------- install
New-Item -ItemType Directory -Force $installDir | Out-Null
Get-ChildItem -Path $installDir -Filter 'denis-*.jar' -ErrorAction SilentlyContinue | Remove-Item -Force
foreach ($item in @('denis-*.jar', 'bin', 'service', 'README.md', 'LICENSE', 'docs')) {
    Get-ChildItem -Path $bundle -Filter $item -ErrorAction SilentlyContinue | Copy-Item -Destination $installDir -Recurse -Force
}
Write-Host "Installed to $installDir"

$binDir = Join-Path $installDir 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $binDir })) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $binDir), 'User')
    Write-Host "Added $binDir to your PATH (open a new terminal to use 'denis')"
}

# ---------------------------------------------------------------- first run
if (-not (Test-Path (Join-Path $installDir 'denis.properties'))) {
    $initArgs = @('init')
    if ($env:DENIS_PROFILE) { $initArgs += @('--profile', $env:DENIS_PROFILE) }
    if ($env:DENIS_BIND) { $initArgs += @('--bind', $env:DENIS_BIND) }
    $env:DENIS_HOME = $installDir
    & (Join-Path $binDir 'denis.bat') @initArgs
} else {
    Write-Host "Existing configuration kept: $installDir\denis.properties"
}

if ($tmp) { Remove-Item -Recurse -Force $tmp }
Write-Host ''
Write-Host 'Done. Start the server with:  denis server'
