# Monta os dois instaladores do Josué:  powershell -ExecutionPolicy Bypass -File installer\build.ps1
#   1) gera a tela do app (npm run build)
#   2) monta a pasta ..\..\instalador\Josue (servidor, tela, Python próprio, bibliotecas e modelos)
#   3) compila "Instalar Josue (leve).exe" e "Instalar Josue (completo).exe" (+ .bin)
$ErrorActionPreference = 'Stop'
$App = Split-Path $PSScriptRoot -Parent
$Out = Join-Path (Split-Path $App -Parent) 'instalador'
$Stage = Join-Path $Out 'Josue'
# Inno Setup 6: procura nos lugares onde ele costuma ser instalado
$ISCC = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path $env:LOCALAPPDATA 'InnoSetup6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $ISCC) { throw 'Inno Setup 6 não encontrado. Instale com: winget install JRSoftware.InnoSetup' }

Push-Location $App
npm run build
if ($LASTEXITCODE) { throw 'falha no build da tela' }
Pop-Location

New-Item -ItemType Directory -Force "$Stage\server\models", "$Stage\models\hf\hub" | Out-Null
Copy-Item "$App\server\*.py", "$App\server\josue.pyw" "$Stage\server" -Force
Copy-Item "$App\server\models\BTC-ISMIR19-master" "$Stage\server\models" -Recurse -Force
if (Test-Path "$Stage\web") { Remove-Item "$Stage\web" -Recurse -Force }
Copy-Item "$App\dist" "$Stage\web" -Recurse
Copy-Item "$PSScriptRoot\setup.ps1", "$PSScriptRoot\requirements-lock.txt" $Stage -Force
# modelos já baixados nesta máquina evitam baixar de novo
$hf = Join-Path $env:USERPROFILE '.cache\huggingface\hub'
Get-ChildItem $hf -Directory -Filter 'models--*' -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not (Test-Path "$Stage\models\hf\hub\$($_.Name)")) { Copy-Item $_.FullName "$Stage\models\hf\hub" -Recurse }
}
# relatórios de teste do modelo de alinhamento: inúteis e com nomes que estouram o limite de 260 caracteres do Windows
Get-ChildItem "$Stage\models\hf\hub" -Recurse -File -Filter '*.txt' | Where-Object { $_.FullName -match 'wav2vec2' } | Remove-Item -Force
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Stage\setup.ps1" -Root $Stage
Get-ChildItem $Stage -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force

Push-Location $PSScriptRoot
& $ISCC josue.iss
& $ISCC /DFULL josue.iss
Pop-Location
Write-Host "Instaladores em $Out" -ForegroundColor Green
