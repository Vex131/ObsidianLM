param(
  [switch]$RemoveLogs
)

. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-Admin
Assert-ObsidianServiceInstalled
Ensure-ServiceDirectories
Assert-WrapperPresent

$service = Get-ObsidianService
if ($service.Status -eq "Running") {
  Stop-Service -Name $script:ServiceName -ErrorAction Stop
  $service.WaitForStatus("Stopped", "00:00:30")
}

Invoke-Wrapper uninstall

if ($RemoveLogs) {
  if (Test-Path -LiteralPath $script:LogDir) {
    Remove-Item -LiteralPath $script:LogDir -Recurse -Force
  }
  "Uninstalled $script:ServiceDisplayName and removed logs. Data was preserved at $script:DataDir."
} else {
  "Uninstalled $script:ServiceDisplayName. Data and logs were preserved under $script:ProgramDataRoot."
}
