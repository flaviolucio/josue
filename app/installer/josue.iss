; Instalador do Josué (Inno Setup 6).
; Versão leve:     ISCC josue.iss                -> baixa Python, bibliotecas e modelos durante a instalação
; Versão completa: ISCC /DFULL josue.iss         -> leva tudo junto (funciona sem internet)
; Antes de compilar, a pasta ..\..\instalador\Josue precisa estar montada (ver build.ps1).

#define AppName "Josué"
#define AppVersion "1.0.0"
#define Stage "..\..\instalador\Josue"

[Setup]
AppId={{6F0D6C1E-9B7A-4C55-9E1D-4A0C3E7B5A10}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppName}
DefaultDirName={localappdata}\Programs\Josue
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
SetupIconFile=josue.ico
UninstallDisplayIcon={app}\josue.ico
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\instalador
#ifdef FULL
OutputBaseFilename=Instalar Josue (completo)
; tudo junto passa de 2 GB: o instalador vem em partes (.exe + .bin) — mantenha os arquivos juntos
DiskSpanning=yes
DiskSliceSize=1900000000
Compression=zip/1
SolidCompression=no
ExtraDiskSpaceRequired=0
#else
OutputBaseFilename=Instalar Josue (leve)
Compression=lzma2
SolidCompression=yes
; Python + bibliotecas + modelos baixados durante a instalação
ExtraDiskSpaceRequired=8000000000
#endif

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
#ifdef FULL
WelcomeLabel2=Isto vai instalar o Josué no seu computador: cifra, letra sincronizada e tablatura a partir de qualquer música.%n%nEsta é a versão completa: não precisa de internet. Precisa de cerca de 9 GB livres.
#else
WelcomeLabel2=Isto vai instalar o Josué no seu computador: cifra, letra sincronizada e tablatura a partir de qualquer música.%n%nEsta é a versão leve: durante a instalação serão baixados cerca de 6 GB (Python, bibliotecas e modelos de IA). Pode levar de 20 a 60 minutos, conforme a internet.
#endif

[Files]
Source: "josue.ico"; DestDir: "{app}"
Source: "{#Stage}\server\*"; DestDir: "{app}\server"; Excludes: "__pycache__"; Flags: recursesubdirs ignoreversion
Source: "{#Stage}\web\*"; DestDir: "{app}\web"; Flags: recursesubdirs ignoreversion
Source: "setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "requirements-lock.txt"; DestDir: "{app}"; Flags: ignoreversion
#ifdef FULL
Source: "{#Stage}\runtime\*"; DestDir: "{app}\runtime"; Excludes: "__pycache__"; Flags: recursesubdirs ignoreversion
Source: "{#Stage}\models\*"; DestDir: "{app}\models"; Flags: recursesubdirs ignoreversion
#endif

[Icons]
Name: "{userdesktop}\Josué"; Filename: "{app}\runtime\pythonw.exe"; Parameters: """{app}\server\josue.pyw"""; WorkingDir: "{app}\server"; IconFilename: "{app}\josue.ico"; Comment: "Cifra, letra e tablatura com IA"
Name: "{userprograms}\Josué"; Filename: "{app}\runtime\pythonw.exe"; Parameters: """{app}\server\josue.pyw"""; WorkingDir: "{app}\server"; IconFilename: "{app}\josue.ico"; Comment: "Cifra, letra e tablatura com IA"
Name: "{userprograms}\Desinstalar o Josué"; Filename: "{uninstallexe}"

[Run]
#ifndef FULL
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -Root ""{app}"""; StatusMsg: "Baixando e instalando o Python, as bibliotecas e os modelos de IA (acompanhe na janela azul)..."; Flags: waituntilterminated
#endif
Filename: "{app}\runtime\pythonw.exe"; Parameters: """{app}\server\josue.pyw"""; WorkingDir: "{app}\server"; Description: "Abrir o Josué agora"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; o que foi baixado/gerado depois da instalação
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\models"
Type: filesandordirs; Name: "{app}\server\__pycache__"

