<#
.SYNOPSIS
  Despliega NEXO en el servidor copiando los archivos desde esta máquina,
  sin Git en el destino. Ver docs/DEPLOYMENT_IIS.md.

.DESCRIPTION
  El servidor de producción NO tiene Git instalado ni el repositorio
  clonado (verificado el 2026-09-11): `C:\nexo` es una copia de archivos.
  Por eso `update-deployment.ps1`, que empieza con `git pull`, no sirve
  ahí — este script es el camino real para ese servidor.

  Qué NO copia, y por qué importa:

  - `web.config`: el del servidor apunta al puerto interno **3080**, y el
    del repositorio al 3000. En ese servidor el 3000 lo ocupa AsisVen (ver
    docs/AUDIT_LOG.md § 2026-09-08), así que pisarlo mandaría el tráfico de
    Nexo a otro sistema y rompería el sitio.
  - `.env` y `backend\.env`: viven solo en el servidor, con las
    credenciales reales.
  - `node_modules`, `.next`, `backend\.venv`, `logs`, `staticfiles`: se
    regeneran en el destino y copiarlos sería lentísimo.

  Igual que `update-deployment.ps1`, compila ANTES de tocar los servicios:
  un build que falla deja el sistema corriendo con la versión anterior.

.PARAMETER CredentialPath
  Ruta a un XML con la credencial del administrador, creado con:
    Get-Credential | Export-CliXml "C:\ruta\deploy.cred"
  El usuario debe ir como DOMINIO\usuario (ej. COURIERUIO\administrador):
  en formato UPN (usuario@dominio) la autenticación por IP falla.

.PARAMETER SkipInstall
  Saltear `npm ci` y `pip install` en el servidor. Para un cambio que solo
  toca código, sin dependencias nuevas: es bastante más rápido.

.EXAMPLE
  .\deploy-from-workstation.ps1 -CredentialPath "$env:TEMP\nexo-deploy.cred"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\nexo",
    [string]$LocalRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,

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

if (-not (Test-Path $CredentialPath)) {
    throw "No existe el archivo de credenciales '$CredentialPath'. Crealo con: Get-Credential | Export-CliXml '$CredentialPath'"
}
$credencial = Import-CliXml $CredentialPath
if ($credencial.UserName -like "*@*") {
    throw "La credencial es '$($credencial.UserName)' (formato UPN). Por IP hace falta DOMINIO\usuario, ej. COURIERUIO\administrador."
}

Write-Paso "Verificando la conexión con $ServerHost"
$identidad = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ScriptBlock {
    "$env:COMPUTERNAME ($env:USERDOMAIN\$env:USERNAME)"
}
Write-Host "  Conectado a $identidad"

$unidad = "NexoDeploy"
New-PSDrive -Name $unidad -PSProvider FileSystem -Root "\\$ServerHost\c`$" -Credential $credencial | Out-Null
try {
    $destinoUNC = "\\$ServerHost\c$" + ($RemoteRoot -replace "^[A-Za-z]:", "")

    # Cada entrada: carpeta de origen relativa + exclusiones propias.
    $carpetas = @(
        @{ Ruta = "src";                Excluir = @() },
        @{ Ruta = "public";             Excluir = @() },
        @{ Ruta = "scripts";            Excluir = @() },
        @{ Ruta = "docs";               Excluir = @() },
        @{ Ruta = "backend\apps";       Excluir = @("__pycache__") },
        @{ Ruta = "backend\config";     Excluir = @("__pycache__") },
        @{ Ruta = "backend\scripts";    Excluir = @("__pycache__") },
        @{ Ruta = "backend\templates";  Excluir = @() },
        @{ Ruta = "backend\requirements"; Excluir = @() }
    )

    foreach ($carpeta in $carpetas) {
        $origen = Join-Path $LocalRoot $carpeta.Ruta
        if (-not (Test-Path $origen)) { continue }
        $destino = Join-Path $destinoUNC $carpeta.Ruta
        Write-Paso "Copiando $($carpeta.Ruta)"

        $parametros = @($origen, $destino, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1")
        if ($carpeta.Excluir.Count -gt 0) {
            $parametros += "/XD"
            $parametros += $carpeta.Excluir
        }
        robocopy @parametros | Out-Null
        # Robocopy devuelve 0-7 en operaciones correctas; 8 o más es error real.
        if ($LASTEXITCODE -ge 8) { throw "robocopy falló al copiar $($carpeta.Ruta) (código $LASTEXITCODE)." }
    }

    # Archivos sueltos de la raíz. web.config queda deliberadamente afuera
    # (ver el encabezado): el del servidor apunta al puerto 3080.
    $sueltos = @(
        "package.json", "package-lock.json", "next.config.ts", "tsconfig.json",
        "eslint.config.mjs", "postcss.config.mjs", "vitest.config.ts",
        "components.json", ".gitignore"
    )
    Write-Paso "Copiando archivos de configuración de la raíz"
    foreach ($archivo in $sueltos) {
        $origen = Join-Path $LocalRoot $archivo
        if (Test-Path $origen) {
            Copy-Item $origen -Destination (Join-Path $destinoUNC $archivo) -Force
            Write-Host "  $archivo"
        }
    }
}
finally {
    Remove-PSDrive $unidad -ErrorAction SilentlyContinue
}

Write-Paso "Compilando y reiniciando en el servidor (esto tarda varios minutos)"
Invoke-Command -ComputerName $ServerHost -Credential $credencial -ArgumentList $RemoteRoot, $SkipInstall.IsPresent, $BackendServiceName, $FrontendServiceName -ScriptBlock {
    param($RemoteRoot, $SkipInstall, $BackendServiceName, $FrontendServiceName)
    $ErrorActionPreference = "Stop"
    $backendDir = Join-Path $RemoteRoot "backend"
    $pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"

    Set-Location $RemoteRoot
    if (-not $SkipInstall) {
        # `npm ci` BORRA node_modules entero antes de reinstalarlo, y el
        # proceso de Next.js lo tiene abierto: con el servicio corriendo
        # falla con EPERM y deja node_modules a medias — el sitio queda
        # vivo pero sin poder compilar ni reiniciarse. Pasó de verdad el
        # 2026-09-11 y costó una caída del sitio. Por eso se detiene el
        # frontend ANTES de instalar, y el sitio queda abajo hasta el final
        # del build; es el precio de reinstalar dependencias.
        Write-Host "-- deteniendo $FrontendServiceName para liberar node_modules (el sitio queda abajo hasta el final)"
        Stop-Service -Name $FrontendServiceName
        Write-Host "-- npm ci"
        # Sin `2>&1`: en PowerShell 5.1 eso convierte cada `npm warn` en un
        # NativeCommandError y aborta el script aunque npm devuelva 0.
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci falló (código $LASTEXITCODE)." }
        Write-Host "-- pip install"
        & $pythonExe -m pip install -r (Join-Path $backendDir "requirements\prod-windows.txt") --quiet
    }

    Write-Host "-- npm run build"
    npm run build
    $codigoBuild = $LASTEXITCODE
    if ($codigoBuild -ne 0) {
        if (-not $SkipInstall) {
            # Se detuvo el frontend para poder instalar, así que el sitio
            # está ABAJO en este momento: no alcanza con abortar. Se intenta
            # levantarlo con el build anterior, que sigue en `.next`.
            Write-Host "-- el build falló y el sitio está abajo: levantando $FrontendServiceName con el build anterior"
            try {
                Start-Service -Name $FrontendServiceName
                Write-Host "-- servicio levantado: el sitio vuelve con la versión anterior"
            }
            catch {
                Write-Host "-- NO se pudo levantar $FrontendServiceName. EL SITIO ESTA CAIDO y requiere atención manual."
            }
        }
        throw "El build falló (código $codigoBuild). No se desplegó la versión nueva."
    }

    Set-Location $backendDir
    Write-Host "-- manage.py check"
    & $pythonExe manage.py check
    Write-Host "-- manage.py migrate"
    & $pythonExe manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { throw "Las migraciones fallaron." }
    Write-Host "-- manage.py collectstatic"
    & $pythonExe manage.py collectstatic --noinput | Out-Null

    Write-Host "-- reiniciando servicios"
    Restart-Service -Name $BackendServiceName
    Restart-Service -Name $FrontendServiceName
    Get-Service -Name $BackendServiceName, $FrontendServiceName | Format-Table Name, Status

    $version = (Get-Content (Join-Path $RemoteRoot "package.json") -Raw | ConvertFrom-Json).version
    Write-Host "-- version desplegada: $version"
}

Write-Paso "Listo"
Write-Host "Verificá el sitio en http://$ServerHost`:4080"
