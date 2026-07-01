. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-ObsidianServiceInstalled

$service = Get-ObsidianService
if ($service.Status -eq "Running") {
  "Service '$script:ServiceName' is already running."
  exit 0
}

Start-Service -Name $script:ServiceName -ErrorAction Stop
"Started $script:ServiceDisplayName."
