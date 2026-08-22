@echo off
setlocal
call "%~dp0_dev-env.bat"

if not exist "%ROOT_DIR%\.env" (
  if not exist "%ROOT_DIR%\.env.example" (
    echo [ERROR] Missing environment template: %ROOT_DIR%\.env.example
    exit /b 1
  )
  copy /Y "%ROOT_DIR%\.env.example" "%ROOT_DIR%\.env" >nul
  if errorlevel 1 (
    echo [ERROR] Could not create %ROOT_DIR%\.env from .env.example.
    exit /b 1
  )
  echo [SETUP] Created local .env from .env.example.
)

if not exist "%PYTHON_BIN%" (
  echo [ERROR] Missing Python virtual environment: %PYTHON_BIN%
  exit /b 1
)

"%PYTHON_BIN%" "%ROOT_DIR%\scripts\backend\generate-local-env-secrets.py" "%ROOT_DIR%\.env" "%ROOT_DIR%\.env.local"
if errorlevel 1 (
  echo [ERROR] Could not prepare local development secrets.
  exit /b 1
)
exit /b 0
