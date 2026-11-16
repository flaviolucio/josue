# Instala o "motor" do Josué numa pasta: Python próprio, bibliotecas e modelos de IA.
# Usado pelo instalador leve (baixa tudo da internet) e para montar o instalador completo.
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -Root "C:\...\Josue"
param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # o Invoke-WebRequest fica muito lento com a barra
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Host.UI.RawUI.WindowTitle = 'Instalando o Josué'

$PyVer = '3.11.9'
$Runtime = Join-Path $Root 'runtime'
$Py = Join-Path $Runtime 'python.exe'
$Tmp = Join-Path $env:TEMP 'josue-setup'
New-Item -ItemType Directory -Force $Tmp, $Runtime | Out-Null

function Step($n, $msg) { Write-Host ''; Write-Host "[$n/4] $msg" -ForegroundColor Cyan }
function Get-File($url, $out) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing; return } catch { if ($i -eq 3) { throw } ; Start-Sleep 3 }
  }
}

try {
  # 1) Python próprio (versão "embeddable": não mexe em outro Python do computador)
  Step 1 "Python $PyVer"
  if (-not (Test-Path $Py)) {
    $zip = Join-Path $Tmp 'python.zip'
    Get-File "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" $zip
    Expand-Archive $zip -DestinationPath $Runtime -Force
    # liga o site-packages (no embeddable ele vem desligado)
    $pth = Get-ChildItem $Runtime -Filter 'python3*._pth' | Select-Object -First 1
    @('python311.zip', '.', 'Lib\site-packages', '..\server', 'import site') | Set-Content $pth.FullName -Encoding ascii
    New-Item -ItemType Directory -Force (Join-Path $Runtime 'Lib\site-packages') | Out-Null
  }
  if (-not (Test-Path (Join-Path $Runtime 'Scripts\pip.exe'))) {
    $gp = Join-Path $Tmp 'get-pip.py'
    Get-File 'https://bootstrap.pypa.io/get-pip.py' $gp
    & $Py $gp --no-warn-script-location
    if ($LASTEXITCODE) { throw 'falha ao instalar o pip' }
  }

  # 2) bibliotecas (versões exatas, testadas)
  Step 2 'Bibliotecas de IA (PyTorch, Demucs, Whisper...) - cerca de 1,5 GB'
  $req = Join-Path $PSScriptRoot 'requirements-lock.txt'
  & $Py -m pip install --no-warn-script-location --no-deps -r $req --extra-index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE) { throw 'falha ao instalar as bibliotecas' }

  # 3 e 4) modelos de IA
  $env:HF_HOME = Join-Path $Root 'models\hf'
  $env:TORCH_HOME = Join-Path $Root 'models\torch'
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
  $env:PYTHONIOENCODING = 'utf-8'
  Step 3 'Modelos da letra: Whisper large-v3 e alinhamento em português (cerca de 4,3 GB)'
  & $Py -c @"
from huggingface_hub import snapshot_download as s
s('jonatasgrosman/wav2vec2-large-xlsr-53-portuguese', allow_patterns=['*.json','pytorch_model.bin','model.safetensors'])
s('Systran/faster-whisper-large-v3')
"@
  if ($LASTEXITCODE) { throw 'falha ao baixar os modelos da letra' }
  Step 4 'Modelo de separação de faixas (Demucs)'
  & $Py -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"
  if ($LASTEXITCODE) { throw 'falha ao baixar o modelo de separação' }

  Write-Host ''
  Write-Host 'Pronto! O Josué está instalado.' -ForegroundColor Green
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  Write-Host ''
  Write-Host "Erro: $_" -ForegroundColor Red
  Write-Host 'Confira a internet e rode o instalador de novo (ele continua de onde parou).'
  Read-Host 'Aperte Enter para fechar'
  exit 1
}
