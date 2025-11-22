# ==========================================
# Script para añadir GStreamer al PATH de Windows
# ==========================================

$gstBinPath = "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin"

# 1. Verificación de Permisos de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Host "❌ ERROR: Este script necesita ejecutarse como Administrador." -ForegroundColor Red
    Write-Host "👉 Por favor, cierra esta ventana, haz clic derecho en PowerShell y selecciona 'Ejecutar como administrador'." -ForegroundColor Yellow
    exit
}

Write-Host "🔍 Verificando configuración..." -ForegroundColor Cyan

# 2. Obtener el PATH actual del sistema (Scope: Machine)
$currentPathRaw = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
# Convertimos el string en un array dividiendo por ';' y eliminamos entradas vacías
$pathArray = $currentPathRaw -split ';' | Where-Object { $_ -ne "" }

# 3. Normalización para comparación (quitamos espacios y barras finales)
$gstBinPathClean = $gstBinPath.TrimEnd('\')
$alreadyExists = $false

foreach ($entry in $pathArray) {
    if ($entry.TrimEnd('\') -eq $gstBinPathClean) {
        $alreadyExists = $true
        break
    }
}

# 4. Lógica de inserción
if ($alreadyExists) {
    Write-Host "⚠️  La ruta ya existe en el PATH. No es necesario hacer cambios." -ForegroundColor Yellow
} else {
    try {
        # Añadimos la nueva ruta al string original con un punto y coma
        # Usamos la ruta original + ; + nueva ruta
        $newPath = $currentPathRaw.TrimEnd(';') + ";" + $gstBinPath
        
        # Guardamos en el Registro de Windows (Permanente)
        [System.Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
        
        # Actualizamos la sesión actual también (para que funcione en esta ventana sin reiniciar)
        $env:Path += ";$gstBinPath"
        
        Write-Host "✅ ¡Éxito! GStreamer ha sido añadido al PATH correctamente." -ForegroundColor Green
        Write-Host "   Ruta: $gstBinPath" -ForegroundColor Gray
        Write-Host "ℹ️  Reinicia tu terminal (o VS Code) para que los cambios surtan efecto en todas partes." -ForegroundColor Cyan
    }
    catch {
        Write-Host "❌ Ocurrió un error al intentar guardar la variable de entorno." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}