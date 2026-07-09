@echo off
setlocal

set DESTINO=%LOCALAPPDATA%\FerroCianorteSyncAgent
set ORIGEM=%~dp0

echo ==========================================================
echo  Instalando o Agente de Sincronizacao Ferro Cianorte
echo ==========================================================
echo.
echo Pasta de instalacao: %DESTINO%
echo.

if not exist "%DESTINO%" mkdir "%DESTINO%"
if not exist "%DESTINO%\queries" mkdir "%DESTINO%\queries"

copy /Y "%ORIGEM%agente.exe" "%DESTINO%\agente.exe" >nul
xcopy /Y /I "%ORIGEM%queries\*.sql.example" "%DESTINO%\queries\" >nul

echo Arquivos copiados.
echo.

rem Cria um atalho na pasta de Inicializacao do Windows, para o agente
rem subir sozinho sempre que o usuario fizer login na maquina.
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$startup = $ws.SpecialFolders('Startup');" ^
  "$atalho = $ws.CreateShortcut(\"$startup\Ferro Cianorte Sync Agent.lnk\");" ^
  "$atalho.TargetPath = '%DESTINO%\agente.exe';" ^
  "$atalho.WorkingDirectory = '%DESTINO%';" ^
  "$atalho.WindowStyle = 7;" ^
  "$atalho.Save()"

echo Atalho de inicio automatico criado.
echo.
echo ==========================================================
echo  Instalacao concluida!
echo ==========================================================
echo.
echo O agente vai abrir agora pela primeira vez. Uma janela de
echo configuracao vai aparecer no seu navegador (localhost:4848) —
echo preencha os dados do Postgres do Link Pro e do Ferro Cianorte.
echo.
echo IMPORTANTE: antes de configurar, ajuste os arquivos em
echo   %DESTINO%\queries\
echo (renomeie de .sql.example para .sql e adapte ao banco real
echo do Link Pro — veja o README para instrucoes).
echo.
pause

start "" "%DESTINO%\agente.exe"

endlocal
