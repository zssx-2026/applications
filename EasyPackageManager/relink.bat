@echo off
chcp 65001 >nul
setlocal

echo [1/4] 关闭所有 epm.exe
taskkill /F /IM epm.exe 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq epm*" 2>nul

echo [2/4] 删除旧 link
call npm unlink -g easy-package-manager 2>nul

echo [3/4] 删除旧的全局安装目录
if exist "C:\Users\%USERNAME%\AppData\Roaming\npm\node_modules\easy-package-manager" (
  rmdir /S /Q "C:\Users\%USERNAME%\AppData\Roaming\npm\node_modules\easy-package-manager"
)

echo [4/4] 重新链接
cd /d "%~dp0"
call npm link
if errorlevel 1 goto :fail

echo.
echo 验证:
echo   epm help
echo   epm list install
goto :eof

:fail
echo 失败
exit /b 1
