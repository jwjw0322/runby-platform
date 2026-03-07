# Wrapper for Windows Task Scheduler to run Ross and persist daily logs.
$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logsDir = Join-Path $repoRoot 'reports\cao\logs'
if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$logFile = Join-Path $logsDir ("cao-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
$startStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'

"[$startStamp] Starting scheduled CAO briefing run" | Out-File -FilePath $logFile -Encoding utf8 -Append

# Capture both stdout and stderr from Node into the same daily log.
node core/chief-agent-officer.js *>> $logFile
$exitCode = $LASTEXITCODE

$endStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
"[$endStamp] Finished scheduled CAO briefing run (exit code: $exitCode)" | Out-File -FilePath $logFile -Encoding utf8 -Append

exit $exitCode
