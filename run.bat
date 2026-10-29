```bat
@echo off
chcp 65001 >nul
title SorbentOpt Manager

cd /d "%~dp0"

echo ========================================
echo       SorbentOpt Manager
echo ========================================
echo.

if not exist "package.json" (
    echo ОШИБКА: package.json не найден.
    echo Сохрани BAT-файл в папке проекта.
    pause
    exit /b 1
)

echo Запуск менеджера...
echo.

call npm run dev

echo.
echo Менеджер остановлен.
pause
```