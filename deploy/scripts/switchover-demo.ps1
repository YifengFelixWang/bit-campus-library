#requires -Version 7.0
<#
计划内主备切换。默认只预览，带 -ConfirmSwitch 才真正提交。
示例：
  .\switchover-demo.ps1 -OperatorPassword 123456789000
  .\switchover-demo.ps1 -OperatorPassword 123456789000 -ConfirmSwitch
#>
param(
    [Parameter(Mandatory = $true)][string]$OperatorPassword,
    [string]$OperatorUser = "ops1",
    [switch]$ConfirmSwitch,
    [string]$BaseUrl = "http://127.0.0.1:18085",
    [string]$IdentityBase = "http://127.0.0.1:8081"
)

. "$PSScriptRoot\OpsClient.ps1" -BaseUrl $BaseUrl -IdentityBase $IdentityBase
$token = Get-OpsToken -Username $OperatorUser -Password $OperatorPassword

$status = Invoke-Ops -Method GET -Path "/api/ops/status?refresh=1" -Token $token
$d = $status.data
if (-not $d.replication.configured) {
    throw "当前未配置备节点（OPS_STANDBY_CONTAINER 为空），不能做切换演示"
}
Write-Host ("切换前：主={0} 备={1} 复制={2} 延迟={3}" -f `
        $d.primary.name, $d.standby.name, $d.replication.state, $d.replication.lagSeconds)

if (-not $ConfirmSwitch) {
    Write-Host "这是预览。确认要切换时加 -ConfirmSwitch。" -ForegroundColor Yellow
    return
}

$created = Invoke-Ops -Method POST -Path "/api/ops/switchover" -Token $token -Body @{ confirm = $true }
Write-Host ("已提交切换任务：{0}" -f $created.data.id) -ForegroundColor Cyan
$task = Wait-OpsTask -TaskId $created.data.id -Token $token -TimeoutSeconds 240
Write-OpsResult -Task $task
