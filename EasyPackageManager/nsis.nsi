; NSIS
!include "MUI2.nsh"
Name "EasyPackageManager"
OutFile "D:\丁陈子豪\EasyPackageManager_Setup.exe"
InstallDir "$PROGRAMFILES64\EasyPackageManager"
RequestExecutionLevel admin
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Install"
  SetOutPath "$INSTDIR"
  File /r "D:\dev\git\applications\EasyPackageManager\dist\*.*"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\EasyPackageManager"
  CreateShortcut "$SMPROGRAMS\EasyPackageManager\epm.lnk" "$INSTDIR\epm.exe"
  CreateShortcut "$SMPROGRAMS\EasyPackageManager\uninstall.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\EasyPackageManager.lnk" "$INSTDIR\epm.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyPackageManager" "DisplayName" "EasyPackageManager"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyPackageManager" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd
Section "Uninstall"
  Delete "$INSTDIR\epm.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\EasyPackageManager\*.*"
  RMDir "$SMPROGRAMS\EasyPackageManager"
  Delete "$DESKTOP\EasyPackageManager.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyPackageManager"
SectionEnd
