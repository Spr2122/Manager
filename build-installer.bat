@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SorbentOpt Manager - сборка установщика
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите LTS: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto error
)
call npm test
if errorlevel 1 goto error
call npm run dist:win
if errorlevel 1 goto error
echo.
echo Готово. Установщик лежит в папке release.
pause
exit /b 0
:error
echo.
echo Сборка завершилась с ошибкой. Скопируйте текст ошибки выше.
pause
exit /b 1
