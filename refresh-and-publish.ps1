# Optional local Garmin download and publication (requires existing valid local key).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path 'garmin\.env.local')) { throw 'Missing garmin\.env.local. Import your existing Garmin key first.' }
py -3 garmin\pull.py
if ($LASTEXITCODE -ne 0) { throw 'Garmin pull failed; nothing will be published.' }
py -3 garmin\build.py
if ($LASTEXITCODE -ne 0) { throw 'Garmin dashboard generation failed.' }
py -3 tools\make_public.py
if ($LASTEXITCODE -ne 0) { throw 'Garmin summary generation failed.' }
git add garmin/data/activities.json garmin/data/daily.json garmin/data/hrv.json garmin/data/profile.json garmin/data/sleep.json garmin/data/state.json garmin/data/weight.json garmin/dashboard.html garmin/summary.json
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host 'Nessun nuovo dato Garmin da pubblicare.'; exit 0 }
git commit -m 'data: aggiornamento Garmin dal PC'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Push failed. Review git status.' }
