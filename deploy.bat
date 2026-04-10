@echo off
chcp 65001 >nul
cd /d "%~dp0"
set SERVER=root@106.14.151.37
set WEB=/usr/share/nginx/html
set BACKEND=/opt/content-creator/backend
set SSH_OPTS=-o StrictHostKeyChecking=no -o ConnectTimeout=10

echo Step 1: Upload frontend...
scp %SSH_OPTS% content-creator-app.html %SERVER%:%WEB%/
scp %SSH_OPTS% admin.html %SERVER%:%WEB%/

echo Step 2: Upload backend...
scp %SSH_OPTS% backend\server.js %SERVER%:%BACKEND%/
scp %SSH_OPTS% backend\db.js %SERVER%:%BACKEND%/
scp %SSH_OPTS% backend\routes\auth.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\ai.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\config.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\extract.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\history.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\codes.js %SERVER%:%BACKEND%/routes/
scp %SSH_OPTS% backend\routes\douyinToText.js %SERVER%:%BACKEND%/routes/

echo Step 3: Restart service...
ssh %SSH_OPTS% %SERVER% "cp %WEB%/content-creator-app.html %WEB%/index.html && pm2 restart wf-api"

echo Done!
pause
