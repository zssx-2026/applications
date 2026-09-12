@echo off
chcp 65001 >nul
cd /d "%~dp0"

taskkill /F /IM epm.exe 2>nul

call npx esbuild bin/epm.js --bundle --platform=node --target=node18 --outfile=dist/bundle.js
if errorlevel 1 goto :fail

call node --experimental-sea-config sea-config.json
if errorlevel 1 goto :fail

del /F /Q dist\epm.exe 2>nul
copy /Y "D:\program\nodejs\node.exe" dist\epm.exe >nul
if errorlevel 1 goto :fail

call npx postject dist\epm.exe NODE_SEA_BLOB dist\epm.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 goto :fail

copy /Y settings.json dist\ >nul
copy /Y url.json dist\ >nul
copy /Y pak.json dist\ >nul
copy /Y update.js dist\ >nul
if not exist dist\.download_temp mkdir dist\.download_temp
if exist dist\lang rmdir /S /Q dist\lang
xcopy /E /I /Y /Q lang dist\lang >nul

echo.
echo 完成: dist\epm.exe
goto :eof

:fail
echo 编译失败
exit /b 1
