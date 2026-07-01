Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ServiceName = "ObsidianLM"
$script:ServiceDisplayName = "ObsidianLM Runtime Manager"
$script:ProjectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$script:ProgramDataBase = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$script:ProgramDataRoot = Join-Path $script:ProgramDataBase "ObsidianLM"
$script:ServiceRuntimeDir = Join-Path $script:ProgramDataRoot "service"
$script:DataDir = Join-Path $script:ProgramDataRoot "data"
$script:LogDir = Join-Path $script:ProgramDataRoot "logs"
$script:RuntimeLogDir = Join-Path $script:LogDir "runtimes"
$script:JobLogDir = Join-Path $script:LogDir "jobs"
$script:ServiceLogDir = Join-Path $script:LogDir "service"
$script:WrapperExeName = "obsidianlm-service.exe"
$script:WrapperExePath = Join-Path $script:ServiceRuntimeDir $script:WrapperExeName
$script:TemplatePath = Join-Path $script:ProjectRoot "scripts\windows\obsidianlm-service.xml"
$script:RuntimeConfigPath = Join-Path $script:ServiceRuntimeDir "obsidianlm-service.xml"

function Assert-Windows {
  if ($env:OS -ne "Windows_NT") {
    throw "Windows service scripts can only run on Windows."
  }
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
  if (-not (Test-IsAdmin)) {
    throw "This operation requires an elevated PowerShell session. Run PowerShell as Administrator and retry."
  }
}

function Get-ObsidianService {
  return Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
}

function Get-ObsidianServiceDetails {
  return Get-CimInstance -ClassName Win32_Service -Filter "Name='$script:ServiceName'" -ErrorAction SilentlyContinue
}

function Get-ServiceExecutablePath {
  param([Parameter(Mandatory = $true)][string]$PathName)
  $trimmed = $PathName.Trim()

  if ($trimmed.StartsWith('"')) {
    $closingQuote = $trimmed.IndexOf('"', 1)
    if ($closingQuote -gt 1) {
      return $trimmed.Substring(1, $closingQuote - 1)
    }
  }

  $exeIndex = $trimmed.IndexOf(".exe", [StringComparison]::OrdinalIgnoreCase)
  if ($exeIndex -lt 0) {
    return $trimmed
  }

  $endIndex = $exeIndex + 4
  if ($trimmed.Length -gt $endIndex -and -not [char]::IsWhiteSpace($trimmed[$endIndex])) {
    return ($trimmed -split "\s+", 2)[0]
  }

  return $trimmed.Substring(0, $endIndex)
}

function Test-ServicePathMatchesWrapper {
  param([Parameter(Mandatory = $true)][string]$PathName)
  $serviceExecutable = Get-ServiceExecutablePath -PathName $PathName
  return [string]::Equals($serviceExecutable, $script:WrapperExePath, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-ObsidianServiceOwned {
  $service = Get-ObsidianService
  if (-not $service) {
    throw "Service '$script:ServiceName' is not installed. Run 'npm run service:install' first."
  }

  $details = Get-ObsidianServiceDetails
  if (-not $details) {
    throw "Unable to inspect service '$script:ServiceName'. Refusing to operate without ownership verification."
  }

  if ($details.DisplayName -ne $script:ServiceDisplayName) {
    throw "Service '$script:ServiceName' has display name '$($details.DisplayName)', not '$script:ServiceDisplayName'. Refusing to operate on a possibly unrelated service."
  }

  if (-not (Test-ServicePathMatchesWrapper -PathName $details.PathName)) {
    throw "Service '$script:ServiceName' executable is '$($details.PathName)', not '$script:WrapperExePath'. Refusing to operate on a possibly unrelated service."
  }
}

function Assert-BuiltService {
  $entrypoint = Join-Path $script:ProjectRoot "apps\service\dist\main.js"
  $webIndex = Join-Path $script:ProjectRoot "apps\web\dist\index.html"
  if (-not (Test-Path -LiteralPath $entrypoint)) {
    throw "Built service entrypoint is missing: $entrypoint. Run 'npm run build' before installing the Windows service."
  }
  if (-not (Test-Path -LiteralPath $webIndex)) {
    throw "Built web UI is missing: $webIndex. Run 'npm run build' before installing the Windows service."
  }
}

function Ensure-ServiceDirectories {
  foreach ($dir in @($script:ProgramDataRoot, $script:ServiceRuntimeDir, $script:DataDir, $script:LogDir, $script:RuntimeLogDir, $script:JobLogDir, $script:ServiceLogDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir | Out-Null
    }
  }
}

function Assert-WrapperPresent {
  if (-not (Test-Path -LiteralPath $script:WrapperExePath)) {
    throw "Windows service wrapper missing: $script:WrapperExePath. Place a WinSW-compatible wrapper executable there named '$script:WrapperExeName'. ObsidianLM does not download binaries automatically."
  }
}

function Write-ServiceConfig {
  $node = (Get-Command node -ErrorAction Stop).Source
  $config = Get-Content -LiteralPath $script:TemplatePath -Raw
  $config = $config.Replace("%NODE_EXE%", [Security.SecurityElement]::Escape($node))
  $config = $config.Replace("%APP_ROOT%", [Security.SecurityElement]::Escape($script:ProjectRoot.Path))
  Set-Content -LiteralPath $script:RuntimeConfigPath -Value $config -Encoding UTF8
}

function Invoke-Wrapper {
  param([Parameter(Mandatory = $true)][string]$Command)
  & $script:WrapperExePath $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Service wrapper command '$Command' failed with exit code $LASTEXITCODE."
  }
}

function Assert-ObsidianServiceInstalled {
  Assert-ObsidianServiceOwned
}
