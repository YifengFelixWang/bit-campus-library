#requires -Version 7.0
<#
公共客户端：登录身份服务、调用 dbops-service、轮询任务。
用法：在其它脚本中 `. "$PSScriptRoot\OpsClient.ps1" -BaseUrl ... -IdentityBase ...`
#>
param(
    [string]$BaseUrl = "http://127.0.0.1:18085",
    [string]$IdentityBase = "http://127.0.0.1:8081"
)

$script:OpsBaseUrl = $BaseUrl.TrimEnd("/")
$script:OpsIdentityBase = $IdentityBase.TrimEnd("/")

function Get-OpsToken {
    param(
        [Parameter(Mandatory = $true)][string]$Username,
        [Parameter(Mandatory = $true)][string]$Password
    )
    $body = @{ username = $Username; password = $Password } | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Method Post -Uri "$script:OpsIdentityBase/auth/login" `
            -ContentType "application/json" -Body $body -TimeoutSec 15
    } catch {
        throw "登录失败：$($_.Exception.Message)。请确认 identity-service 已启动，账号 $Username 存在。"
    }
    if (-not $response.accessToken) {
        throw "登录响应里没有 accessToken：$($response | ConvertTo-Json -Compress)"
    }
    return $response.accessToken
}

function Invoke-Ops {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Body,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $headers = @{ Authorization = "Bearer $Token"; Accept = "application/json" }
    $params = @{
        Method      = $Method
        Uri         = "$script:OpsBaseUrl$Path"
        Headers     = $headers
        TimeoutSec  = 90
        ErrorAction = "Stop"
    }
    if ($Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json -Depth 5)
    }
    try {
        $response = Invoke-RestMethod @params
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "请求 $Method $Path 失败：$detail"
    }
    if ($response.code -and $response.code -ne "OK") {
        throw "接口返回 $($response.code)：$($response.message)"
    }
    return $response
}

function Wait-OpsTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskId,
        [Parameter(Mandatory = $true)][string]$Token,
        [int]$TimeoutSeconds = 240
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastStep = ""
    while ((Get-Date) -lt $deadline) {
        $response = Invoke-Ops -Method GET -Path "/api/ops/tasks/$TaskId" -Token $Token
        $task = $response.data
        $current = @($task.steps | Where-Object { $_.status -eq "RUNNING" } | Select-Object -Last 1)
        if ($current.Count -gt 0 -and $current[0].name -ne $lastStep) {
            $lastStep = $current[0].name
            Write-Host ("  [{0}] {1}" -f $TaskId, $lastStep) -ForegroundColor Cyan
        }
        if ($task.status -in @("SUCCEEDED", "FAILED")) {
            return $task
        }
        Start-Sleep -Seconds 2
    }
    throw "任务 $TaskId 在 $TimeoutSeconds 秒内没有结束，请到页面查看"
}

function Write-OpsResult {
    param([Parameter(Mandatory = $true)]$Task)
    $tone = if ($Task.status -eq "SUCCEEDED") { "Green" } else { "Red" }
    Write-Host ("任务 {0}：{1}" -f $Task.id, $Task.status) -ForegroundColor $tone
    if ($Task.error) {
        Write-Host ("失败原因：{0}" -f $Task.error) -ForegroundColor Red
        return
    }
    if ($Task.result) {
        $Task.result | ConvertTo-Json -Depth 8
    }
}
