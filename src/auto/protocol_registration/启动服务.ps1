param(
    [int]$Count = 10,
    [int]$Workers = 3,
    [switch]$VerboseLog,
    [switch]$UseRoxyCdp
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$env:PYTHONUTF8 = "1"
if ($UseRoxyCdp) {
    if ($Workers -ne 1) {
        Write-Error "启用 Roxy CDP 时只能使用单线程：请加 -Workers 1。"
        exit 1
    }
    $env:ROXY_CDP_ENABLED = "1"
}
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainPath = Join-Path $projectRoot "main.py"

# Prefer an initialized conda command, then fall back to common Windows installs.
$condaCommand = Get-Command conda -ErrorAction SilentlyContinue
$condaInvoker = $null
if ($condaCommand) {
    $condaInvoker = "conda"
} else {
    $candidates = @(
        "F:\anaconda\anaconda3\condabin\conda.bat",
        "F:\anaconda\anaconda3\Scripts\conda.exe",
        "$env:USERPROFILE\miniconda3\condabin\conda.bat",
        "$env:USERPROFILE\anaconda3\condabin\conda.bat",
        "$env:LOCALAPPDATA\miniconda3\condabin\conda.bat",
        "$env:LOCALAPPDATA\anaconda3\condabin\conda.bat",
        "C:\ProgramData\miniconda3\condabin\conda.bat",
        "C:\ProgramData\anaconda3\condabin\conda.bat"
    )
    $condaInvoker = $candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

if (-not $condaInvoker) {
    Write-Error "未找到 conda。请先安装/初始化 Conda，或把 conda 加入 PATH；目标环境为 tilian。"
    exit 1
}

$pythonArgs = @(
    $mainPath,
    "-n", $Count,
    "--workers", $Workers,
    "--continue-on-fail"
)
if ($VerboseLog) {
    $pythonArgs += "--verbose"
}

Set-Location -LiteralPath $projectRoot
& $condaInvoker run --no-capture-output -n tilian python @pythonArgs
exit $LASTEXITCODE
