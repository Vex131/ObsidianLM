. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-ObsidianServiceInstalled

$service = Get-ObsidianService

[PSCustomObject]@{
  Name = $service.Name
  DisplayName = $service.DisplayName
  Status = $service.Status.ToString()
  DataDir = $script:DataDir
  LogDir = $script:LogDir
  ServiceDir = $script:ServiceRuntimeDir
} | Format-List
