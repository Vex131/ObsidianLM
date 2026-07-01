. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-ObsidianServiceInstalled

$service = Get-ObsidianService
if ($service.Status -eq "Stopped") {
  "Service '$script:ServiceName' is already stopped."
  exit 0
}

Stop-Service -Name $script:ServiceName -ErrorAction Stop
"Stopped $script:ServiceDisplayName."
