. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-ObsidianServiceInstalled

Restart-Service -Name $script:ServiceName -ErrorAction Stop
"Restarted $script:ServiceDisplayName."
