# Agentic Office PC agent: install and link this Windows computer (docs/PC-AGENT.md).
# Run as:  irm {{SERVER}}/i/{{CODE}}/win | iex
# No admin needed. Installs to %LOCALAPPDATA%\AgenticOffice (Node.js from nodejs.org, checked
# against its SHA-256, and the agent from your office server), links with a one-time code, and
# starts with Windows (Task Manager > Startup apps: "AgenticOfficePC").
# Remove it any time:  agentic-pc uninstall
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Server = '{{SERVER}}'
  $Code = '{{CODE}}'
  $NodeMajor = '22'
  $Prog = Join-Path $env:LOCALAPPDATA 'AgenticOffice'
  $Conf = Join-Path $env:APPDATA 'AgenticOffice'
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }

  function Say($text) { Write-Host "  $text" }
  function Sha256($file) { (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower() }

  Write-Host ''
  Write-Host 'Agentic Office: linking this computer to your AI' -ForegroundColor Cyan
  Write-Host "  Server: $Server"

  New-Item -ItemType Directory -Force -Path $Prog, $Conf, (Join-Path $Prog 'agent'), (Join-Path $Prog 'bin') | Out-Null

  # An agent already running (reinstall / relink) holds node.exe: stop it first.
  $lock = Join-Path $Conf 'agent.lock'
  if (Test-Path $lock) {
    $old = [int](Get-Content -LiteralPath $lock -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old) { try { Stop-Process -Id $old -Force -ErrorAction Stop; Start-Sleep -Milliseconds 800 } catch {} }
  }

  # 1. Node.js (the latest of the pinned LTS line), verified against nodejs.org's SHASUMS256.
  $dist = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  $sums = [string](Invoke-WebRequest -UseBasicParsing "$dist/SHASUMS256.txt").Content
  $line = ($sums -split "`n") | Where-Object { $_ -match "node-v$NodeMajor\.[0-9.]+-win-$Arch\.zip\s*$" } | Select-Object -First 1
  if (-not $line) { throw "Could not find Node.js $NodeMajor for Windows $Arch on nodejs.org." }
  $want, $zipName = ($line.Trim() -split '\s+')
  $nodeDir = Join-Path $Prog 'node'
  $stamp = Join-Path $nodeDir '.release'
  $have = if (Test-Path $stamp) { (Get-Content -LiteralPath $stamp | Select-Object -First 1) } else { '' }
  if ($have -ne $zipName -or -not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    Say "Downloading $zipName from nodejs.org ..."
    $tmp = Join-Path $env:TEMP ("agentic-node-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp $zipName
    Invoke-WebRequest -UseBasicParsing "$dist/$zipName" -OutFile $zip
    if ((Sha256 $zip) -ne $want.ToLower()) { throw 'The Node.js download did not match its checksum. Nothing was installed.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -LiteralPath $tmp -Directory | Where-Object { $_.Name -like 'node-v*' } | Select-Object -First 1
    if (Test-Path $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $nodeDir
    Set-Content -LiteralPath $stamp -Value $zipName -Encoding ascii
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Say "Node.js is up to date ($zipName)."
  }
  $node = Join-Path $nodeDir 'node.exe'

  # 2. The agent (one file from your office server), verified against its SHA-256.
  Say 'Downloading the agent from your office server ...'
  $agent = Join-Path $Prog 'agent\agent.cjs'
  $part = "$agent.part"
  Invoke-WebRequest -UseBasicParsing "$Server/downloads/pc-agent/agent.cjs" -OutFile $part
  $agentSum = ([string](Invoke-WebRequest -UseBasicParsing "$Server/downloads/pc-agent/agent.cjs.sha256").Content).Trim().Split(' ')[0].ToLower()
  if ((Sha256 $part) -ne $agentSum) { Remove-Item -LiteralPath $part -Force; throw 'The agent download did not match its checksum. Nothing was installed.' }
  Move-Item -LiteralPath $part -Destination $agent -Force

  # 3. The `agentic-pc` command, and a launcher that starts it without a console window.
  $cmd = Join-Path $Prog 'bin\agentic-pc.cmd'
  Set-Content -LiteralPath $cmd -Encoding ascii -Value "@`"%~dp0..\node\node.exe`" `"%~dp0..\agent\agent.cjs`" %*"
  $vbs = Join-Path $Prog 'bin\launch.vbs'
  Set-Content -LiteralPath $vbs -Encoding ascii -Value @(
    "' Starts the Agentic Office PC agent in the background (no console window).",
    'Set sh = CreateObject("WScript.Shell")',
    "sh.Run """"""$node"""" """"$agent"""" run"", 0, False"
  )
  $bin = Join-Path $Prog 'bin'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $bin)) {
    [Environment]::SetEnvironmentVariable('Path', ((@($userPath, $bin) | Where-Object { $_ }) -join ';'), 'User')
  }
  $env:Path = "$env:Path;$bin"

  # 4. Link with the one-time code.
  Say 'Linking ...'
  & $node $agent link $Code --server $Server
  if ($LASTEXITCODE -ne 0) { throw 'Linking did not work. Make a new code on the My computers page and try again.' }

  # 5. Start with Windows, and start now.
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  New-ItemProperty -Path $run -Name 'AgenticOfficePC' -Value "wscript.exe `"$vbs`"" -PropertyType String -Force | Out-Null
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""

  Write-Host ''
  Write-Host 'Linked. Your AI can now use this computer (the folders you shared only).' -ForegroundColor Green
  Say 'Shared folders, pause, unlink and activity: the My computers page, or the agentic-pc command:'
  Say '  agentic-pc status | folders | pause | resume | logs | unlink | uninstall'
  Write-Host ''
}
