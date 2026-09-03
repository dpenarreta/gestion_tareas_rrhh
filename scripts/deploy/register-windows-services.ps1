<#
.SYNOPSIS
  Registra el backend (Django/waitress) y el frontend (Next.js) como
  Windows Services usando NSSM, para que arranquen solos con el servidor y
  se reinicien si el proceso muere. Ver docs/DEPLOYMENT_IIS.md.

.DESCRIPTION
  Requiere NSSM (https://nssm.cc/) ya descargado y con nssm.exe en el PATH
  o pasado explícitamente con -NssmPath. Este script NO descarga nada —
  descargar NSSM es una decisión tuya, hacela vos mismo desde el sitio
  oficial. Debe correrse en una consola de PowerShell "Ejecutar como
  administrador" (crear un servicio de Windows exige privilegios elevados).

.PARAMETER RepoRoot
  Ruta absoluta a la raíz del repositorio ya clonado/copiado en el
  servidor (con el frontend ya "npm run build" y el backend con su venv
  ya creado — ver la guía).

.PARAMETER NssmPath
  Ruta a nssm.exe. Por defecto asume que ya está en el PATH.

.EXAMPLE
  .\register-windows-services.ps1 -RepoRoot "C:\nexo"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$NssmPath = "nssm.exe",

    [string]$BackendServiceName = "NexoBackend",
    [string]$FrontendServiceName = "NexoFrontend",

    [string]$BackendHost = "127.0.0.1",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

function Assert-Nssm {
    $cmd = Get-Command $NssmPath -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "No se encontró '$NssmPath'. Descargá NSSM desde https://nssm.cc/download, " +
              "extraé nssm.exe (win64) y pasá su ruta con -NssmPath, o agregala al PATH."
    }
}

function Register-Service {
    param(
        [string]$Name,
        [string]$Exe,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$DisplayName,
        [string]$Description
    )

    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "El servicio '$Name' ya existe — se reconfigura en vez de recrearlo."
        & $NssmPath set $Name Application $Exe
        & $NssmPath set $Name AppParameters $Arguments
        & $NssmPath set $Name AppDirectory $WorkingDirectory
    } else {
        & $NssmPath install $Name $Exe $Arguments
        & $NssmPath set $Name AppDirectory $WorkingDirectory
    }

    & $NssmPath set $Name DisplayName $DisplayName
    & $NssmPath set $Name Description $Description
    & $NssmPath set $Name Start SERVICE_AUTO_START
    # Reinicio automático si el proceso muere — mismo criterio que
    # "restart: unless-stopped" en docker-compose.yml para el contenedor
    # de SQL Server de desarrollo.
    & $NssmPath set $Name AppExit Default Restart
    & $NssmPath set $Name AppRestartDelay 5000
    # stdout/stderr a archivos de log rotados diariamente — sin esto, un
    # crash del proceso no deja rastro accesible (no hay terminal
    # interactiva corriendo un servicio de Windows).
    $logDir = Join-Path $WorkingDirectory "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    & $NssmPath set $Name AppStdout (Join-Path $logDir "$Name.out.log")
    & $NssmPath set $Name AppStderr (Join-Path $logDir "$Name.err.log")
    & $NssmPath set $Name AppRotateFiles 1
    & $NssmPath set $Name AppRotateOnline 1
    & $NssmPath set $Name AppRotateBytes 10485760

    Write-Host "Servicio '$Name' registrado. Iniciando..."
    Start-Service -Name $Name
    Get-Service -Name $Name | Format-Table Name, Status, StartType
}

Assert-Nssm

$backendDir = Join-Path $RepoRoot "backend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "No se encontró el venv del backend en '$pythonExe'. Crealo primero (ver docs/DEPLOYMENT_IIS.md)."
}

Register-Service `
    -Name $BackendServiceName `
    -Exe $pythonExe `
    -Arguments "scripts\serve_production_windows.py --host $BackendHost --port $BackendPort" `
    -WorkingDirectory $backendDir `
    -DisplayName "NEXO - Backend (Django/waitress)" `
    -Description "API de NEXO detrás de IIS. Ver docs/DEPLOYMENT_IIS.md."

$npmExe = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmExe) { $npmExe = (Get-Command npm -ErrorAction Stop).Source }

Register-Service `
    -Name $FrontendServiceName `
    -Exe $npmExe `
    -Arguments "start -- -p $FrontendPort" `
    -WorkingDirectory $RepoRoot `
    -DisplayName "NEXO - Frontend (Next.js)" `
    -Description "UI de NEXO detrás de IIS. Ver docs/DEPLOYMENT_IIS.md."

Write-Host ""
Write-Host "Listo. Verificá con: Get-Service $BackendServiceName, $FrontendServiceName"
Write-Host "Logs en: $backendDir\logs\ y $RepoRoot\logs\"
