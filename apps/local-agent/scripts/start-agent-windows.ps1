# Script de inicio del Agente Local en Windows (Ratatube)
# Utiliza exclusivamente la carpeta temporal del sistema operativo (os.tmpdir) y se autolimpia al cerrar.

Write-Host "Iniciando Agente Local Ratatube (Windows)..." -ForegroundColor Amber
$env:LOCAL_AGENT_PORT = "45820"
$env:LOCAL_AGENT_TEMP_QUOTA_MB = "8192"

npm run dev:agent

