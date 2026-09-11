<#
.SYNOPSIS
  Actualiza un despliegue ya existente de NEXO en el servidor: trae el
  código nuevo, reinstala dependencias si hacen falta, compila el frontend,
  aplica migraciones y reinicia los dos servicios. Ver docs/DEPLOYMENT_IIS.md.

.DESCRIPTION
  Para un servidor donde NEXO YA está instalado y corriendo (si es una
  instalación desde cero, seguí la guía completa: este script no crea el
  venv, no registra los servicios ni configura IIS).

  OJO — ESTE SCRIPT ASUME GIT EN EL SERVIDOR. SER-WEBAI (10.0.2.33), el
  único servidor donde NEXO está desplegado hoy, NO tiene Git instalado ni
  el repositorio clonado: `C:\nexo` es una copia de archivos (verificado el
  2026-09-11). Para ese servidor usá
  `deploy-from-workstation.ps1`, que copia los archivos desde tu máquina.
  Este script sirve con `-SkipGitPull` si copiás el código por otro medio,
  o tal cual en un servidor que sí tenga el repositorio clonado.

  El orden importa y no es arbitrario: se compila ANTES de tocar los
  servicios, así un build que falla deja el sistema corriendo con la versión
  anterior en vez de dejarlo caído a medio actualizar. Los servicios se
  reinician al final, cuando ya está todo listo en disco.

  Cada paso verifica su codigo de salida y aborta ahi mismo, sin seguir
  con los siguientes. Las advertencias de `manage.py check` (por ejemplo
  las de configuracion de correo) se muestran pero NO detienen el
  despliegue: son advertencias a proposito.

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

# "Continue" y NO "Stop": con "Stop", PowerShell 5.1 aborta en cuanto un
# ejecutable externo escribe UNA linea en stderr, aunque termine con codigo
# 0 — la envuelve en un NativeCommandError terminante. Eso rompia dos pasos
# normales: los "npm warn deprecated" de npm ci y las advertencias
# nexo.email.* de manage.py check, que existen a proposito mientras el
# correo no este configurado. A cambio, cada comando externo evalua su
# $LASTEXITCODE y los cmdlets que si deben cortar llevan -ErrorAction Stop.
$ErrorActionPreference = "Continue"

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
        # `npm ci` borra node_modules entero antes de reinstalarlo, y el
        # proceso de Next.js lo tiene abierto: con el servicio corriendo
        # falla con EPERM y deja node_modules a medias — el sitio queda vivo
        # pero sin poder compilar ni reiniciarse. Pasó de verdad el
        # 2026-09-11 y costó una caída. Desde acá el sitio queda abajo hasta
        # el final del build: es el precio de reinstalar dependencias.
        Write-Paso "Deteniendo $FrontendServiceName para liberar node_modules (el sitio queda abajo hasta el final)"
        Stop-Service -Name $FrontendServiceName -ErrorAction Stop

        Write-Paso "Dependencias del frontend (npm ci)"
        # Sin `2>&1`: en PowerShell 5.1 eso convierte cada `npm warn` en un
        # NativeCommandError y aborta aunque npm haya devuelto 0.
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci falló (código $LASTEXITCODE)." }

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
    $codigoBuild = $LASTEXITCODE
    if ($codigoBuild -ne 0) {
        if (-not $SkipInstall) {
            # Con -SkipInstall el sitio nunca se detuvo y sigue arriba. Sin
            # él, se detuvo para instalar: está ABAJO y hay que levantarlo
            # con el build anterior, que sigue en `.next`.
            Write-Paso "El build falló y el sitio está abajo: levantando $FrontendServiceName con el build anterior"
            try {
                Start-Service -Name $FrontendServiceName -ErrorAction Stop
                Write-Host "  Servicio levantado: el sitio vuelve con la versión anterior."
            }
            catch {
                Write-Host "  NO se pudo levantar $FrontendServiceName. EL SITIO ESTA CAIDO y requiere atención manual."
            }
        }
        throw "El build del frontend falló (código $codigoBuild). No se desplegó la versión nueva."
    }

    Push-Location $backendDir
    try {
        Write-Paso "Verificando la configuración del backend (manage.py check)"
        # No aborta el despliegue: los checks de correo son advertencias a
        # propósito (ver apps/core/checks.py). Se muestran para que queden a
        # la vista de quien despliega.
        # Las advertencias (`nexo.email.*`, por ejemplo) salen por stderr y
        # son intencionales: se muestran, no cortan el despliegue.
        & $pythonExe manage.py check
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ATENCION: manage.py check devolvio $LASTEXITCODE. Revisa la salida de arriba."
        }

        Write-Paso "Aplicando migraciones"
        & $pythonExe manage.py migrate --noinput
        if ($LASTEXITCODE -ne 0) { throw "Las migraciones fallaron (codigo $LASTEXITCODE)." }

        Write-Paso "Recolectando estáticos"
        & $pythonExe manage.py collectstatic --noinput | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "collectstatic fallo (codigo $LASTEXITCODE)." }
    }
    finally {
        Pop-Location
    }

    Write-Paso "Reiniciando servicios"
    Restart-Service -Name $BackendServiceName -ErrorAction Stop
    Restart-Service -Name $FrontendServiceName -ErrorAction Stop
    Get-Service -Name $BackendServiceName, $FrontendServiceName | Format-Table Name, Status, StartType

    Write-Paso "Listo"
    Write-Host "Verificá que el sitio responda y revisá los logs si algo no arranca:"
    Write-Host "  $backendDir\logs\NexoBackend.err.log"
    Write-Host "  $RepoRoot\logs\NexoFrontend.err.log"
}
finally {
    Pop-Location
}

# Salida explicita en 0: los ejecutables externos (npm, manage.py) escriben
# en stderr de forma rutinaria y eso deja el codigo de salida del proceso
# en 1 aunque el despliegue haya terminado bien. Si algo falla de verdad,
# un `throw` de los de arriba corta antes y el proceso sale distinto de 0.
exit 0
