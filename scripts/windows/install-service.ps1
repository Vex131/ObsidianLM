. "$PSScriptRoot\common-service.ps1"

Assert-Windows
Assert-Admin
Assert-BuiltService
Ensure-ServiceDirectories
Assert-WrapperPresent

$existing = Get-ObsidianService
if ($existing) {
  if ($existing.DisplayName -ne $script:ServiceDisplayName) {
    throw "A service named '$script:ServiceName' already exists with display name '$($existing.DisplayName)'. Refusing to overwrite an unrelated service."
  }
  throw "Service '$script:ServiceName' is already installed. Use npm run service:status, service:start, service:stop, or service:uninstall."
}

Write-ServiceConfig
Invoke-Wrapper install
"Installed $script:ServiceDisplayName. Start it with: npm run service:start"
