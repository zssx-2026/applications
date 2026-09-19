@echo off
chcp 65001 >nul
set SRC=D:\dev\git\applications\EasyPackageManager
set DST=D:\丁陈子豪\EasyPackageManager
echo [1/6] kill
taskkill /F /IM epm.exe 2>nul
echo [2/6] clean zip
if exist "D:\丁陈子豪\EasyPackageManager_sp5.zip" del /f /q "D:\丁陈子豪\EasyPackageManager_sp5.zip"
echo [3/6] compress
powershell -NoProfile -Command "Compress-Archive -Path '%SRC%' -DestinationPath 'D:\丁陈子豪\EasyPackageManager_sp5.zip' -Force"
if errorlevel 1 goto fail
echo [4/6] copy dist
if exist "%DST%" rmdir /s /q "%DST%"
xcopy "%SRC%\dist\" "%DST%\" /E /I /Y /H /R >nul
if errorlevel 1 goto fail
echo [5/6] nsis
where makensis >nul 2>nul
if errorlevel 1 (echo [!] makensis missing) else (makensis "%SRC%\nsis.nsi")
echo [6/6] done
echo   zip:  D:\丁陈子豪\EasyPackageManager_sp5.zip
echo   dist: %DST%
goto :eof
:fail
echo FAIL
exit /b 1
