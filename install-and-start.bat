@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SorbentOpt Manager
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите LTS-версию: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Устанавливаю зависимости, это нужно один раз...
  call npm install
  if errorlevel 1 goto error
)
echo Собираю и запускаю приложение...
call npm run build
if errorlevel 1 goto error
call npm run preview
exit /b 0
:error
echo.
echo Не получилось. Скопируйте текст ошибки выше и покажите разработчику.
pause
exit /b 1
