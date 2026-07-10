@echo off
setlocal

echo ==========================================================
echo  Instalando o Agente de Sincronizacao Ferro Cianorte
echo ==========================================================
echo.
echo Se este computador so vai sincronizar UMA loja, aperte Enter
echo direto (sem digitar nada).
echo.
echo Se este computador vai rodar o agente de VARIAS lojas ao mesmo
echo tempo (ex.: Matriz, Floriano e SJP, todas conectando em
echo Postgres remotos diferentes a partir daqui), digite um nome
echo diferente para cada instalacao (ex.: Matriz, depois rode este
echo instalador de novo digitando Floriano, depois SJP).
echo.
set /p NOME_INSTANCIA="Nome desta instancia (opcional): "

if "%NOME_INSTANCIA%"=="" (
  set DESTINO=%LOCALAPPDATA%\FerroCianorteSyncAgent
  set NOME_ATALHO=Ferro Cianorte Sync Agent.lnk
  set PORTA_PADRAO=4848
) else (
  set DESTINO=%LOCALAPPDATA%\FerroCianorteSyncAgent_%NOME_INSTANCIA%
  set NOME_ATALHO=Ferro Cianorte Sync Agent - %NOME_INSTANCIA%.lnk
  set PORTA_PADRAO=4848
)

set ORIGEM=%~dp0

echo.
echo Pasta de instalacao: %DESTINO%
echo.

if not exist "%DESTINO%" mkdir "%DESTINO%"
if not exist "%DESTINO%\queries" mkdir "%DESTINO%\queries"

copy /Y "%ORIGEM%agente.exe" "%DESTINO%\agente.exe" >nul
xcopy /Y /I "%ORIGEM%queries\*.sql.example" "%DESTINO%\queries\" >nul

echo Arquivos copiados.
echo.

rem Cria um atalho (com nome proprio desta instancia) na pasta de
rem Inicializacao do Windows, para o agente subir sozinho no login —
rem cada instancia (se houver mais de uma nesta maquina) tem o seu, sem
rem sobrescrever o atalho das outras.
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$startup = $ws.SpecialFolders('Startup');" ^
  "$atalho = $ws.CreateShortcut(\"$startup\%NOME_ATALHO%\");" ^
  "$atalho.TargetPath = '%DESTINO%\agente.exe';" ^
  "$atalho.WorkingDirectory = '%DESTINO%';" ^
  "$atalho.WindowStyle = 7;" ^
  "$atalho.Save()"

echo Atalho de inicio automatico criado: %NOME_ATALHO%
echo.
echo ==========================================================
echo  Instalacao concluida!
echo ==========================================================
echo.
echo O agente vai abrir agora pela primeira vez. Uma janela de
echo configuracao vai aparecer no seu navegador —
echo preencha os dados do Postgres do Link Pro e do Ferro Cianorte.
echo.
echo IMPORTANTE: se este NAO for o unico agente nesta maquina, troque
echo a "Porta desta janela de configuracao" (campo dentro da propria
echo janela, secao Comportamento) para uma porta diferente das outras
echo instalacoes (ex.: 4848 para a primeira, 4849 para a segunda, 4850
echo para a terceira) — senao elas vao brigar pela mesma porta.
echo.
echo Tambem ajuste os arquivos em %DESTINO%\queries\ (renomeie de
echo .sql.example para .sql — ja vem prontos pro schema real do Link
echo Pro, nao precisa editar o conteudo, so tirar o .example do nome).
echo.
pause

start "" "%DESTINO%\agente.exe"

endlocal
