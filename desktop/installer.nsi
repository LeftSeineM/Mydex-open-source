Unicode true
!include "MUI2.nsh"
Name "Mydex"
OutFile "..\dist\Mydex-0.4.26-Setup.exe"
InstallDir "D:\Software\MydexMobileApp"
InstallDirRegKey HKCU "Software\MydexMobileConnector" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "Mydex.ico"
UninstallIcon "Mydex.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Mydex.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Mydex"
 SetOutPath "$INSTDIR"
 SetOverwrite ifdiff
 File /r /x data /x qa /x qa-private /x OffscreenQA.exe /x qa-error.txt "..\build\desktop-v0426\*"
 WriteRegStr HKCU "Software\MydexMobileConnector" "InstallDir" "$INSTDIR"
 CreateDirectory "$SMPROGRAMS\Mydex 电脑连接"
 CreateShortcut "$SMPROGRAMS\Mydex 电脑连接\Mydex.lnk" "$INSTDIR\Mydex.exe"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MydexMobileConnector" "DisplayName" "Mydex 电脑连接"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MydexMobileConnector" "DisplayVersion" "0.4.26"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MydexMobileConnector" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MydexMobileConnector" "DisplayIcon" "$INSTDIR\Mydex.exe"
SectionEnd
Section "Uninstall"
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MydexMobileConnector"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MydexMobileConnector"
 DeleteRegKey HKCU "Software\MydexMobileConnector"
 Delete "$DESKTOP\Mydex 电脑连接.lnk"
 Delete "$SMPROGRAMS\Mydex 电脑连接\Mydex.lnk"
 RMDir "$SMPROGRAMS\Mydex 电脑连接"
 ; Explicit owned program trees only. User data and imported config are retained.
 RMDir /r "$INSTDIR\runtime"
 RMDir /r "$INSTDIR\desktop"
 RMDir /r "$INSTDIR\gateway"
 Delete "$INSTDIR\Mydex.exe"
 Delete "$INSTDIR\LICENSE.txt"
 Delete "$INSTDIR\README.md"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
