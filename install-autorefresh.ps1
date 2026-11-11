# Esegui con PowerShell dal progetto, non occorre pubblicare alcuna chiave.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'sync.py'
if (-not (Test-Path $script)) { throw 'sync.py non trovato' }
$name = 'Copenhagen21K-Garmin'
$action = New-ScheduledTaskAction -Execute 'py.exe' -Argument ('-3 -u "' + $script + '"') -WorkingDirectory $root
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '06:30'),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel LeastPrivilege
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Attivita '$name' creata: ogni giorno alle 06:30 e all'accesso a Windows."
Write-Host 'La sincronizzazione richiede PC acceso, Internet e sessione Windows attiva.'
