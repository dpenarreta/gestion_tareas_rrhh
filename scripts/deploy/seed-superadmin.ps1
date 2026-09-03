<#
.SYNOPSIS
  Crea el usuario ADMINISTRADOR inicial en la base de datos de producción
  (vacía) — envoltorio de `python manage.py seed_superadmin`. Ver
  docs/DEPLOYMENT_IIS.md. Idempotente: correrlo dos veces no duplica nada.

.PARAMETER RepoRoot
  Ruta absoluta a la raíz del repositorio en el servidor.

.PARAMETER Email
  Correo del administrador inicial.

.PARAMETER Username
  Por defecto "admin".

.EXAMPLE
  .\seed-superadmin.ps1 -RepoRoot "C:\nexo" -Email "admin@miempresa.com"
  # Pide la contraseña de forma interactiva (oculta) si no se pasa.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$Email,

    [string]$Username = "admin"
)

$ErrorActionPreference = "Stop"

$backendDir = Join-Path $RepoRoot "backend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "No se encontró el venv del backend en '$pythonExe'."
}

Push-Location $backendDir
try {
    $env:DJANGO_SETTINGS_MODULE = "config.settings.production"
    & $pythonExe manage.py seed_superadmin --email $Email --username $Username
} finally {
    Pop-Location
}
