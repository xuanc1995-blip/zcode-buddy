$projectRoot = Split-Path $PSScriptRoot -Parent
$target = Join-Path $projectRoot 'release\win-unpacked\ZCode Buddy.exe'
if (-not (Test-Path -LiteralPath $target)) { Write-Host 'target exe not found'; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $desktop 'ZCode Buddy.lnk'
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $target
$lnk.WorkingDirectory = Split-Path $target
$lnk.Description = 'ZCode Buddy'
$lnk.Save()
Write-Host "created: $lnkPath"
