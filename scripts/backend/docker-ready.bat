@echo off
setlocal

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker CLI was not found on PATH.
  echo [ERROR] Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 exit /b 0

echo [DOCKER] Docker Desktop is installed but the daemon is not ready. Starting it...
powershell -NoProfile -NonInteractive -Command "$candidates=@((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe')); $path=$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1; if (-not $path) { throw 'Docker Desktop executable was not found' }; Start-Process -FilePath $path"
if errorlevel 1 (
  echo [ERROR] Could not start Docker Desktop automatically.
  echo [ACTION] Confirm Docker Desktop is installed and approve any Windows security prompt.
  exit /b 1
)

echo [DOCKER] Waiting for docker info, timeout 120 seconds...
for /l %%I in (1,1,60) do (
  docker info >nul 2>&1 && exit /b 0
  ping 127.0.0.1 -n 3 >nul
)
echo [ERROR] Docker daemon did not become ready within 120 seconds.
echo [ACTION] Open Docker Desktop, complete its first-launch or permission confirmation, then rerun the command.
exit /b 1
