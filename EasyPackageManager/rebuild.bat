@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/8] 关闭 epm.exe
taskkill /F /IM epm.exe 2>nul

echo [2/8] 打包 bundle
call npx esbuild bin/epm.js --bundle --platform=node --target=node18 --outfile=dist/bundle.js
if errorlevel 1 goto :fail

echo [3/8] 生成 blob
call node --experimental-sea-config sea-config.json
if errorlevel 1 goto :fail

echo [4/8] 复制 node.exe
del /F /Q dist\epm.exe 2>nul
copy /Y "D:\program\nodejs\node.exe" dist\epm.exe >nul
if errorlevel 1 goto :fail

echo [5/8] 注入 blob
call npx postject dist\epm.exe NODE_SEA_BLOB dist\epm.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
if errorlevel 1 goto :fail

echo [6/8] 同步 aria2c.exe
if exist "bin\aria2c.exe" (
  copy /Y "bin\aria2c.exe" "dist\aria2c.exe" >nul
) else (
  echo [!] bin\aria2c.exe 不存在
)

echo [7/8] 同步配置文件
copy /Y settings.json dist\ >nul
copy /Y url.json dist\ >nul
copy /Y pak.json dist\ >nul
copy /Y update.js dist\ >nul
if not exist dist\.download_temp mkdir dist\.download_temp

echo [8/8] 同步语言文件
if exist dist\lang rmdir /S /Q dist\lang
xcopy /E /I /Y /Q lang dist\lang >nul

echo.
echo 完成: dist\epm.exe
goto :eof

:fail
echo 编译失败
exit /b 1
