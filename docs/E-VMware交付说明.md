# VMware 交付说明

适合没有云主机、也暂时不想在本机装 Docker Desktop 的场景：在一台 Windows/macOS 机器的 VMware 里开 Ubuntu 虚拟机，把整套服务跑在虚拟机内。

> 状态：本文是交付步骤与检查表，**尚未在 VMware 上实跑**。如果虚拟机也没有 `CAP_SYS_ADMIN`、Docker 起不来，可改走 `E-云部署说明.md` 第 9 节的原生 openGauss 路线；该路线已在云主机上验证。

## 1. 虚拟机规格

| 项 | 建议 |
| --- | --- |
| 版本 | Ubuntu Server 22.04 LTS |
| CPU / 内存 | 4 vCPU / 8 GB（两个 openGauss 容器时内存给到 10 GB 更稳） |
| 磁盘 | 40 GB 精简置备；数据卷会随 dump 增长 |
| 网络 | 首选 NAT（能上网装 Docker）；需要同网段访问时加一块 Host-only |
| 快照 | 装完 Docker、导入数据后各打一个快照 |

静态 IP（Host-only 示例，`/etc/netplan/00-installer-config.yaml`）：

```yaml
network:
  ethernets:
    ens33:
      dhcp4: false
      addresses: [192.168.56.20/24]
  version: 2
```

```bash
sudo netplan apply
```

## 2. 安装 Docker 与工具

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
docker version
```

## 3. 放代码

三种方式任选：

1. `git clone <仓库地址> ~/campus-library`（虚拟机能上网）；
2. VMware 共享文件夹：虚拟机设置 → Options → Shared Folders 指向仓库目录，在 `/mnt/hgfs/...` 访问，复制到 `~/campus-library`；
3. 宿主机 `scp -r` 到虚拟机。

不要把宿主机的 `.env`、`backups/*.dump` 带进去；虚拟机内重新生成口令。

## 4. 启动

```bash
cd ~/campus-library/database/opengauss
cp .env.example .env && vi .env      # 设 LIBRARY_LOCAL_PASSWORD
docker compose up -d

# 等健康检查通过后按 06-重建顺序.md 导入 library 库
cd ~/campus-library/deploy/local-identity
cp .env.example .env && vi .env      # 填各角色口令、OPS_DB_PASSWORD
docker compose -f compose.yaml -f compose.web.yaml up -d --build
```

浏览器访问：

- NAT：宿主机访问 `http://<虚拟机IP>:8080`，或在 VMware 里加端口转发 `8080 -> 虚拟机 8080`；
- Host-only：宿主机直接访问 `http://192.168.56.20:8080`。

## 5. 主备演示（可选）

单机双容器：

```bash
cd ~/campus-library/deploy/opengauss-ha
cp .env.example .env && vi .env
docker compose up -d --build
```

先停掉单实例容器释放 15432：`docker stop library-opengauss`。主备起来后把 `deploy/local-identity/.env` 的 `OPS_DB_CONTAINER` / `OPS_STANDBY_CONTAINER` 改成 `library-opengauss-a` / `library-opengauss-b`，重启网页栈。

两台虚拟机做主备：A 机跑主容器、B 机跑备容器，按 `docs/E-云部署说明.md` 第 8 节改 `replconninfo1` 和 IP，Host-only 网络下用 `192.168.56.20/21` 这类固定地址最省事。

## 6. 快照与回滚

- 演示前：`sudo docker compose ... stop`，再打 VMware 快照，避免数据库文件处于写状态；
- 演示中切主备、恢复验证库都可以反复做，不影响快照；
- 演示失败：关机 → 恢复快照 → 重新启动 compose，2 分钟内回到基线；
- 不要在有 dump 写入时直接快照，容易得到不一致的数据库文件。

## 7. 验收检查

1. `docker compose ps` 全部 healthy/up；
2. `curl http://127.0.0.1:8080/api/ops/health` 返回 `UP`；
3. 页面登录 `ops1`，主备服务器页显示节点与数据库状态；
4. 做一次备份，任务详情四步全绿；
5. 恢复到 `library_verify_vm`，8 项对象核对通过；
6. （主备）切换后新主可写，业务重新登录能借书。

把命令输出与页面截图存入 `docs/e-evidence/`，回填测试报告。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| 虚拟机内存不足，openGauss 启动被 OOM | 关闭不必要的服务，内存加到 10 GB；`docker stats` 看占用 |
| 宿主机访问不到 8080 | 检查 VMware 网络模式、Ubuntu `ufw`（`sudo ufw allow 8080/tcp`）、compose 绑定地址是否为 `127.0.0.1` |
| 共享文件夹里直接跑 compose 报权限/软链接错误 | 把仓库复制到虚拟机本地磁盘再跑，不要在 `/mnt/hgfs` 下运行 |
| 快照恢复后数据库起不来 | 快照前未停容器导致数据文件不一致；回到更早的快照，或 `docker compose down -v` 后重导 |
