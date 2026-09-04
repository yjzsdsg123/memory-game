# ============================================================
#  记忆力挑战 —— 一键部署到 GitHub Pages
#  双击同目录下的「部署.bat」即可运行；
#  或在本文件夹打开 PowerShell 执行： .\deploy.ps1 "本次改动说明"
# ============================================================
$ErrorActionPreference = 'Stop'

$Git = 'C:\Users\俞\.local\lib\PortableGit\cmd\git.exe'
$Ssh = 'C:\Users\俞\.local\lib\PortableGit\usr\bin\ssh.exe'
$Key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path

# 走 SSH over 443 通道（国内直连 github.com:443 会被重置）
$env:GIT_SSH_COMMAND = "`"$Ssh`" -i `"$Key`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

Set-Location $Repo

# 1) 先判断有没有真正的改动（没有就直接退出，不产生空提交）
& $Git add -A | Out-Null
$changed = & $Git status --porcelain
if (-not $changed) {
    Write-Host '没有检测到改动，无需部署。' -ForegroundColor Yellow
    exit 0
}

# 2) 自动升级 Service Worker 缓存版本，确保手机端刷新后拿到最新资源
$sw = Join-Path $Repo 'sw.js'
if (Test-Path $sw) {
    $content = [System.IO.File]::ReadAllText($sw)
    if ($content -match 'mem-game-v(\d+)') {
        $newVer = [int]$Matches[1] + 1
        $content = [System.Text.RegularExpressions.Regex]::Replace($content, 'mem-game-v\d+', "mem-game-v$newVer")
        [System.IO.File]::WriteAllText($sw, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "已升级缓存版本 -> v$newVer" -ForegroundColor Cyan
        & $Git add -A | Out-Null
    }
}

# 3) 提交（可传入提交说明，否则用时间戳）
$msg = $args[0]
if (-not $msg) { $msg = 'update: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
& $Git commit -m $msg | Out-Null
Write-Host "已提交：$msg" -ForegroundColor Cyan

# 4) 推送
Write-Host '正在推送...' -ForegroundColor Cyan
& $Git push origin main
if ($LASTEXITCODE -ne 0) { throw '推送失败，请检查网络后重试' }

Write-Host ''
Write-Host '==================================================' -ForegroundColor Green
Write-Host ' 部署成功！约 1 分钟后手机刷新页面即可看到新版' -ForegroundColor Green
Write-Host ' https://yjzsdsg123.github.io/memory-game/' -ForegroundColor Green
Write-Host '==================================================' -ForegroundColor Green
