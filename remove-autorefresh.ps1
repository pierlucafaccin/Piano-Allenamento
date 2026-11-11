$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'Copenhagen21K-Garmin' -Confirm:$false
Write-Host 'Sincronizzazione automatica disattivata.'
