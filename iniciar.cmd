@echo off
rem P4J3 Prospect: atualiza o codigo, instala dependencias novas e abre o app.
cd /d "%~dp0"
echo.
echo === P4J3 Prospect ===
echo Buscando atualizacoes no GitHub...
git pull --ff-only origin main
if errorlevel 1 (
  echo Nao foi possivel atualizar agora ^(sem internet ou alteracoes locais^). Abrindo a versao atual.
)
echo Conferindo dependencias...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo FALHA ao instalar dependencias. Verifique a conexao e rode de novo.
  pause
  exit /b 1
)
echo Abrindo o app...
call npm start
