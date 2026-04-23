@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "TARGET_URL=http://localhost:3000/photoshoot"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false; try { $r=Invoke-WebRequest -UseBasicParsing '%TARGET_URL%' -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$ok=$true} } catch {}; if(-not $ok){ Start-Process cmd.exe -ArgumentList '/c','cd /d ""%~dp0"" && ""%NODE_EXE%"" server.js' -WindowStyle Minimized; Start-Sleep -Seconds 3 }; Start-Process '%TARGET_URL%'"

endlocal
