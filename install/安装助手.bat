@echo off
rem ============================================================
rem  抖音可可助手 · 安装助手
rem
rem  本文件是 UTF-8 编码的源码模板，入库保存只为便于阅读和修改。
rem  分发时由 scripts/make-dist.py 自动转成 GBK + CRLF 后放进 zip，
rem  请不要直接双击本模板文件（中文会显示成乱码）。
rem
rem  本机测试时可临时指定目标目录，避免动到真实的 C:\DY-COCO：
rem      set DYC_TARGET=C:\temp\test && "!安装助手.bat"
rem ============================================================
chcp 936 >nul
setlocal

title 抖音可可助手 - 安装助手

set "SRC=%~dp0"
set "TARGET=C:\DY-COCO"
if not "%DYC_TARGET%"=="" set "TARGET=%DYC_TARGET%"

rem 复制之前先记住目标里有没有旧版本，末尾的提示要用到这个标志。
set "HAD_OLD=0"
if exist "%TARGET%\manifest.json" set "HAD_OLD=1"

rem 本机自动化测试开关：设 DYC_SILENT=1 可跳过写剪贴板、打开文件夹和
rem 「按任意键」等待，便于脚本化回归验证。正式安装时不会设置这个变量。
set "SILENT=0"
if not "%DYC_SILENT%"=="" set "SILENT=1"

cls
echo.
echo ============================================================
echo              抖音可可助手  -  安装助手
echo ============================================================
echo.

if not exist "%SRC%manifest.json" goto :err_nosource

if "%HAD_OLD%"=="1" (
  echo [提示] 检测到 %TARGET% 里已经装过插件，本次会覆盖成最新版本。
  echo.
) else (
  echo 安装位置：%TARGET%
  echo.
)

echo 正在复制文件，请稍等 ...
echo.

if not exist "%TARGET%" mkdir "%TARGET%" 2>nul
if not exist "%TARGET%" goto :err_nomkdir

xcopy "%SRC%src"   "%TARGET%\src\"   /E /I /Y /Q >nul
xcopy "%SRC%icons" "%TARGET%\icons\" /E /I /Y /Q >nul
if exist "%SRC%LICENSE"       xcopy "%SRC%LICENSE"       "%TARGET%\" /Y /Q >nul
if exist "%SRC%!安装说明.txt" xcopy "%SRC%!安装说明.txt" "%TARGET%\" /Y /Q >nul

rem 清单文件最后复制：中途失败时浏览器读到的仍是旧版本，不会半新半旧。
xcopy "%SRC%manifest.json" "%TARGET%\" /Y /Q >nul

echo 正在校验 ...
if not exist "%TARGET%\manifest.json"                     goto :err_copy
if not exist "%TARGET%\icons\icon16.png"                  goto :err_copy
if not exist "%TARGET%\icons\icon48.png"                  goto :err_copy
if not exist "%TARGET%\icons\icon128.png"                 goto :err_copy
if not exist "%TARGET%\src\content\main.js"               goto :err_copy
if not exist "%TARGET%\src\popup\popup.html"              goto :err_copy
if not exist "%TARGET%\src\background\service-worker.js"  goto :err_copy
if not exist "%TARGET%\src\update\update.js"              goto :err_copy

echo 复制完成。
echo.

if "%SILENT%"=="1" goto :skip_ui

rem 把安装路径写进剪贴板，第 3 步选择文件夹时直接 Ctrl+V 即可。
echo %TARGET%| clip
echo 已把安装路径复制到剪贴板，第 3 步会用到。
echo.

echo 正在打开安装文件夹 ...
start "" explorer "%TARGET%"
echo.
goto :show_next

:skip_ui
echo [测试模式] 已跳过剪贴板写入与打开文件夹。
echo.

:show_next

echo ------------------------------------------------------------
echo  接下来请做这三件事：
echo ------------------------------------------------------------
echo.
echo   1. 打开浏览器，在地址栏输入 chrome://extensions 然后回车
echo      （Edge 浏览器请输入 edge://extensions）
echo.
echo   2. 打开页面右上角的【开发者模式】开关
echo.
echo   3. 点左上角【加载已解压的扩展程序】，
echo      在弹出的窗口里按 Ctrl+V，再按回车
echo.
echo ------------------------------------------------------------
echo.

if exist "%SRC%!安装说明.txt" (
  echo 完整说明在同一个文件夹里的【!安装说明.txt】，双击即可打开。
  echo.
)

if "%HAD_OLD%"=="1" (
  echo 本次覆盖的是旧版本，请到扩展页面点一下卡片上的刷新按钮，
  echo 然后在抖店页面按 F5。
  echo.
)

if "%SILENT%"=="1" exit /b 0
echo 按任意键关闭本窗口。
pause >nul
exit /b 0


:err_nosource
echo.
echo [错误] 没有找到 manifest.json
echo.
echo 请先把压缩包【完整解压】出来，再双击里面的安装助手。
echo 不要直接在压缩包的预览窗口里双击本文件。
echo.
if "%SILENT%"=="1" exit /b 1
echo 按任意键关闭。
pause >nul
exit /b 1


:err_nomkdir
echo.
echo [错误] 无法创建文件夹 %TARGET%
echo.
echo 请右键本文件，选择【以管理员身份运行】。
echo.
if "%SILENT%"=="1" exit /b 1
echo 按任意键关闭。
pause >nul
exit /b 1


:err_copy
echo.
echo [错误] 文件复制不完整。
echo.
echo 常见原因是 360 等安全软件拦截了复制操作。
echo 请关闭安全软件后重试，或右键本文件选择【以管理员身份运行】。
echo.
if "%SILENT%"=="1" exit /b 1
echo 按任意键关闭。
pause >nul
exit /b 1
