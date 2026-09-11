<#
.SYNOPSIS
  Actualiza un despliegue ya existente de NEXO en el servidor: trae el
  código nuevo, reinstala dependencias si hacen falta, compila el frontend,
  aplica migraciones y reinicia los dos servicios. Ver docs/DEPLOYMENT_IIS.md.

.DESCRIPTION
  Para un servidor donde NEXO YA está instalado y corriendo (si es una
  instalación desde cero, seguí la guía completa: este script no crea el
  venv, no registra los servicios ni configura IIS).

  El orden importa y no es arbitrario: se compila ANTES de tocar los
  servicios, así un build que falla deja el sistema corriendo con la versión
  anterior en vez de dejarlo caído a medio actualizar. Los servicios se
  reinician al final, cuando ya está todo listo en disco.

  Cada paso se verifica; ante el primer error el script se detiene
  (`$ErrorActionPreference = "Stop"`) sin seguir con los siguientes.

.PARAMETER RepoRoot
  Ruta absoluta a la raíz del repositorio en el servidor (ej. "C:\nexo").

.PARAMETER SkipGitPull
  No ejecutar `git pull`. Usalo cuando el código se copia a mano al
  servidor en vez de traerlo desde el remoto.

.PARAMETER SkipInstall
  Saltear `npm ci` y `pip install`. Sirve para una actualización que solo
  cambia código, sin dependencias nuevas — es bastante más rápida.

.EXAMPLE
  .\update-deployment.ps1 -RepoRoot "C:\nexo"

.EXAMPLE
  # El código ya se copió a mano y no cambiaron las dependencias:
  .\update-deployment.ps1 -RepoRoot "C:\nexo" -SkipGitPull -SkipInstall
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [switch]$SkipGitPull,
    [switch]$SkipInstall,

    [string]$BackendServiceName = "NexoBackend",
    [string]$FrontendServiceName = "NexoFrontend"
)

$ErrorActionPreference = "Stop"

function Write-Paso {
    param([string]$Texto)
    Write-Host ""
    Write-Host "== $Texto" -ForegroundColor Cyan
}

if (-not (Test-Path $RepoRoot)) {
    throw "No existe la ruta '$RepoRoot'."
}

$backendDir = Join-Path $RepoRoot "backend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    throw "No se encontró el venv del backend en '$pythonExe'. Esto actualiza un despliegue existente, no crea uno nuevo (ver docs/DEPLOYMENT_IIS.md)."
}
foreach ($servicio in @($BackendServiceName, $FrontendServiceName)) {
    if (-not (Get-Service -Name $servicio -ErrorAction SilentlyContinue)) {
        throw "No existe el servicio '$servicio'. Registralo primero con register-windows-services.ps1."
    }
}

# Los .env NO se tocan nunca: viven solo en el servidor, con las
# credenciales reales, y no están en el repositorio.
foreach ($archivo in @((Join-Path $RepoRoot ".env"), (Join-Path $backendDir ".env"))) {
    if (-not (Test-Path $archivo)) {
        throw "Falta '$archivo'. Sin él la aplicación no arranca (ver docs/DEPLOYMENT_IIS.md)."
    }
}

Push-Location $RepoRoot
try {
    if (-not $SkipGitPull) {
        Write-Paso "Trayendo el código nuevo (git pull)"
        git pull
        if ($LASTEXITCODE -ne 0) { throw "git pull falló." }
    }
    else {
        Write-Paso "git pull salteado (-SkipGitPull)"
    }

    if (-not $SkipInstall) {
        Write-Paso "Dependencias del frontend (npm ci)"
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci falló." }

        Write-Paso "Dependencias del backend (pip install)"
        & $pythonExe -m pip install -r (Join-Path $backendDir "requirements\prod-windows.txt") --quiet
        if ($LASTEXITCODE -ne 0) { throw "pip install falló." }
    }
    else {
        Write-Paso "Instalación de dependencias salteada (-SkipInstall)"
    }

    # Antes de tocar los servicios: si esto falla, el sistema sigue
    # corriendo con la versión anterior.
    Write-Paso "Compilando el frontend (npm run build)"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "El build del frontend falló. No se reinició ningún servicio: el sistema sigue corriendo con la versión anterior." }

    Push-Location $backendDir
    try {
        Write-Paso "Verificando la configuración del backend (manage.py check)"
        # No aborta el despliegue: los checks de correo son advertencias a
        # propósito (ver apps/core/checks.py). Se muestran para que queden a
        # la vista de quien despliega.
        & $pythonExe manage.py check

        Write-Paso "Aplicando migraciones"
        & $pythonExe manage.py migrate --noinput
        if ($LASTEXITCODE -ne 0) { throw "Las migraciones fallaron." }

        Write-Paso "Recolectando estáticos"
        & $pythonExe manage.py collectstatic --noinput | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "collectstatic falló." }
    }
    finally {
        Pop-Location
    }

    Write-Paso "Reiniciando servicios"
    Restart-Service -Name $BackendServiceName
    Restart-Service -Name $FrontendServiceName
    Get-Service -Name $BackendServiceName, $FrontendServiceName | Format-Table Name, Status, StartType

    Write-Paso "Listo"
    Write-Host "Verificá que el sitio responda y revisá los logs si algo no arranca:"
    Write-Host "  $backendDir\logs\NexoBackend.err.log"
    Write-Host "  $RepoRoot\logs\NexoFrontend.err.log"
}
finally {
    Pop-Location
}
