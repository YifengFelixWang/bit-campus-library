# 云主机部署说明

适用：一台 Linux 云主机（Ubuntu 22.04 / 4 核 8 GB / 40 GB 起）跑完整演示栈；两台云主机跑主备时见最后一节。以下命令用 `ubuntu` 用户 + `sudo`，root 用户去掉 `sudo`。

## 1. 网络与安全组

| 端口 | 来源 | 用途 |
| --- | --- | --- |
| 22 | 管理员 IP | SSH |
| 80 | 0.0.0.0/0 | HTTP 演示入口（没有域名时） |
| 443 | 0.0.0.0/0 | HTTPS（配了证书后） |
| 15432 / 18085 / 8081 / 8083 | 仅本机或跳板机 | 数据库与各服务，**不要对公网开放** |

云厂商安全组只放行 22/80/443；`docker-compose` 里的 `127.0.0.1:18085` 等绑定已经限制在本机回环。

## 2. 安装 Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # 重新登录后生效
docker version
```

## 3. 上传代码与启动数据库

```bash
sudo mkdir -p /opt/campus-library && sudo chown "$USER" /opt/campus-library
# 任选一种：git clone，或 scp 整个仓库（不要带 .env、backups/*.dump）
git clone <仓库地址> /opt/campus-library
cd /opt/campus-library

# 启动 openGauss 单实例（D 的 compose）
cd database/opengauss
cp .env.example .env 2>/dev/null || true
# 编辑 .env：LIBRARY_LOCAL_PASSWORD 换成长随机口令
docker compose up -d
docker logs -f library-opengauss
```

数据库健康后，按 `database/opengauss/06-重建顺序.md` 导入：

```bash
docker exec -i -u omm library-opengauss gsql -U gaussdb -W "$LIBRARY_LOCAL_PASSWORD" -p 5432 -d postgres < init.sql
# 再执行初始化角色、导入 library.sql，具体文件名以 D 的文档为准
```

## 4. 配置业务与运维服务

```bash
cd /opt/campus-library/deploy/local-identity
cp .env.example .env
vi .env
```

生产环境必须替换的项：

```dotenv
LIBRARY_JDBC_URL=jdbc:opengauss://host.docker.internal:15432/library
LIBRARY_PUBLIC_BASE_URL=http://<公网IP或域名>
OPS_DB_PASSWORD=<与 LIBRARY_LOCAL_PASSWORD 相同>
OPS_DB_CONTAINER=library-opengauss
OPS_NODE_A_HOST=127.0.0.1
```

所有业务角色口令重新生成，不要沿用本机的 `123456789000`。

启动：

```bash
docker compose -f compose.yaml -f compose.web.yaml up -d --build
docker compose -f compose.yaml -f compose.web.yaml ps
```

### 80 端口

compose 默认把 web 映射到 `127.0.0.1:8080`。演示可直接改成 `80:80`：

```yaml
ports:
  - "80:80"
```

若需要 HTTPS，建议宿主机装 Nginx 反代到 `127.0.0.1:8080`，用 certbot 申请证书；容器内 Nginx 不直接处理证书。

## 5. 验证

```bash
curl -fsS http://127.0.0.1:8080/api/ops/health
TOKEN=$(curl -s -X POST http://127.0.0.1:8081/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"ops1","password":"<运维口令>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/api/ops/status | python3 -m json.tool
```

浏览器访问 `http://<公网IP>/`，用 `ops1` 登录，依次检查：主备服务器页节点卡片、备份与恢复页、创建一次备份、恢复到 `library_verify_云`、看任务详情。

## 6. 备份与日志

- 页面或 `deploy/scripts` 发起的备份落在 `/opt/campus-library/backups`，含 `.dump` 与 `.dump.json` 清单；
- 每日定时备份示例（crontab，凌晨 2 点）：

```bash
0 2 * * * cd /opt/campus-library/deploy/scripts && pwsh -File backup-demo.ps1 -OperatorPassword "$OPS_PASSWORD" >> /var/log/library-backup.log 2>&1
```

云主机若没有 PowerShell，可改用 curl 调 `POST /api/ops/backups`，或直接 `docker exec ... gs_dump` 后 `docker cp`。

- 把 `backups/` 同步到对象存储（`ossutil`/`aws s3 cp`），保留 7 天；本机磁盘只有 40 GB，dump 会持续增长；
- 日志：`docker compose logs -f --tail 200`，或接云厂商日志服务。

## 7. 升级与回滚

```bash
cd /opt/campus-library
git pull
cd deploy/local-identity
docker compose -f compose.yaml -f compose.web.yaml up -d --build
```

回滚：`git checkout <上一个提交>` 后重新 `up -d --build`；数据库结构变更前先做一次备份。

## 8. 两台云主机做主备（可选）

`deploy/opengauss-ha/compose.yaml` 是**单机双容器**演示。两台机器时：

1. 两台都装 Docker，仓库路径一致；
2. 节点 A 只启动主容器，节点 B 只启动备容器（或拆成两个 compose 文件）；
3. `entrypoint-ha.sh` 里的 `replconninfo1` 改成 A 的内网 IP，端口 5433；
4. 安全组只允许 B 访问 A 的 5433，A 访问 B 的 5433；
5. 业务 JDBC 写两个内网地址：`jdbc:opengauss://10.0.0.1:15432,10.0.0.2:15432/library?targetServerType=master`；
6. `dbops-service` 的 `OPS_DB_CONTAINER` 通过 `DOCKER_HOST=ssh://...` 或部署在 A 上只管理本机容器——跨机管理不在当前实现范围内，需另加 SSH 执行器。

课程演示优先用单机双容器，跨机方案只在文档里说明差异，不作为默认路径。

## 9. 没有 Docker 时的原生 openGauss（本次云主机实测）

云主机若没有 `CAP_SYS_ADMIN`，`dockerd` 起不来，`apt install docker.io` 也会在容器层报错。本次在 Ubuntu 22.04 云主机上改用 openGauss-Lite 原生安装，已验证可行。

```bash
mkdir -p /home/user/og && cd /home/user/og
# 下载 openGauss-Lite 7.0.0-RC3 openEuler22.03 x86_64 包并解压
# ./install.sh 交互安装；OS 用户填 user，安装目录 /home/user/og/app，数据目录 /home/user/og/data
export GAUSSHOME=/home/user/og/app
export GAUSSLOG=/home/user/og/log
export PATH=$GAUSSHOME/bin:$PATH
export LD_LIBRARY_PATH=$GAUSSHOME/lib:/home/user/og/dependency
```

常见缺库与处理：

- `libopenblas.so.0`：从 `openblas-0.3.18-3.oe2203` RPM 解包，把 `libopenblas-r0.3.18.so` 复制为 `/home/user/og/dependency/libopenblas.so.0`；
- `libedit.so.0`：从 `libedit-3.1-28.oe2203` RPM 解包，把 `libedit.so.0.0.68` 复制为 `/home/user/og/dependency/libedit.so.0`。

初始化后实例默认由 OS 用户 `user` 持有；先以 `-U user` 登录，创建 `gaussdb` SYSADMIN 角色，再导入 D 的 `library.sql`。不要假设一定有 `omm` 用户和 `/var/lib/opengauss/data`。

主备（同机双实例）注意：

- node-a 数据目录 `/home/user/og/data`，SQL 15432，HA 端口 15433；
- node-b 数据目录 `/home/user/og/data-b`，SQL 15443，HA 端口 15444；
- `gs_initdb --nodename` 只能用下划线，`db-b` 这类连字符会报非法；
- 两节点的 `max_locks_per_transaction`、`max_prepared_transactions` 必须一致，否则旧主降备时会报 `hot standby is not possible`；
- 切换：`gs_ctl switchover -D /home/user/og/data-b -t 120`，本次命令 5.3 秒、端到端 7.7 秒；
- 切换后业务 JDBC 必须双地址 + `targetServerType=master`。

本次真实结果与截图见 `docs/e-evidence/README.md`。原生安装只适合课程演示，生产仍应使用容器或官方 OM 安装。

## 10. 安全底线

- `.env` 权限 `600`，不进 Git；
- 数据库、18085 不暴露公网；
- 定期轮换 `ops1` 口令；
- `dbops-service` 挂载 `docker.sock` 等价 root，云上只给受信管理员使用，或改为受限 API。
