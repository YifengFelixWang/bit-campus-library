"""运行配置。所有配置来自环境变量，口令只从环境读取，不写入日志和任务文件。"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def _flag(name: str, default: bool = False) -> bool:
    return _env(name, "true" if default else "false").lower() in ("1", "true", "yes", "on")


class Config:
    """一次性读取环境变量。修改配置需要重启服务。"""

    def __init__(self) -> None:
        self.service_name = "dbops-service"
        self.version = "1.0.0"
        self.port = int(_env("DBOPS_PORT", "18085"))
        self.identity_url = _env("IDENTITY_URL", "http://127.0.0.1:8081").rstrip("/")
        self.required_role = _env("OPS_REQUIRED_ROLE", "OPERATOR").upper()

        # docker：在宿主机 / 运维容器内通过 docker exec 操作数据库容器
        # local：直接调用本机已安装的 gs_dump / gs_restore / gs_ctl
        self.exec_mode = _env("OPS_EXEC_MODE", "docker").lower()
        self.docker_bin = _env("OPS_DOCKER_BIN", "docker")
        self.db_container = _env("OPS_DB_CONTAINER", "library-opengauss")
        self.standby_container = _env("OPS_STANDBY_CONTAINER", "")
        self.db_os_user = _env("OPS_DB_OS_USER", "omm")

        self.db_name = _env("OPS_DB_NAME", "library")
        self.db_user = _env("OPS_DB_USER", "gaussdb")
        self.db_password = os.environ.get("OPS_DB_PASSWORD", "")
        self.db_port = int(_env("OPS_DB_PORT", "5432"))
        self.db_host = _env("OPS_DB_HOST", "127.0.0.1")
        self.database_datadir = _env("OPS_DB_DATADIR", "/var/lib/opengauss/data")
        # 页面上展示的节点地址（容器映射到宿主机的实际端口，按实际部署填写）
        self.node_a_host = _env("OPS_NODE_A_HOST", "127.0.0.1")
        self.node_a_port = int(_env("OPS_NODE_A_PORT", "15432"))
        self.node_b_host = _env("OPS_NODE_B_HOST", "127.0.0.1")
        self.node_b_port = int(_env("OPS_NODE_B_PORT", "15433"))

        self.backup_dir = Path(_env("OPS_BACKUP_DIR", "/backup"))
        self.task_dir = Path(_env("OPS_TASK_DIR", "/var/lib/dbops/tasks"))
        self.verify_db_prefix = _env("OPS_VERIFY_DB_PREFIX", "library_verify")
        self.allow_production_restore = _flag("OPS_ALLOW_PRODUCTION_RESTORE", False)
        self.checklist_sql = Path(_env("OPS_CHECKLIST_SQL", "/opt/dbops/sql/15-对象核对清单.sql"))

        self.command_timeout = int(_env("OPS_COMMAND_TIMEOUT_SECONDS", "300"))
        self.switchover_timeout = int(_env("OPS_SWITCHOVER_TIMEOUT_SECONDS", "150"))
        self.status_cache_seconds = float(_env("OPS_STATUS_CACHE_SECONDS", "3"))
        self.max_log_chars = int(_env("OPS_MAX_LOG_CHARS", "20000"))
        self.retain_backups = int(_env("OPS_RETAIN_BACKUPS", "0"))

        self.tz = timezone(timedelta(hours=8))

    # ---------------------------------------------------------------- 校验
    def problems(self) -> list[str]:
        """启动时打印的配置缺口，不阻止启动（页面应能看到未配置的原因）。"""
        result: list[str] = []
        if not self.db_password:
            result.append("OPS_DB_PASSWORD 未设置，无法执行备份/恢复/状态查询")
        if self.exec_mode not in ("docker", "local"):
            result.append("OPS_EXEC_MODE 只能是 docker 或 local")
        if self.exec_mode == "docker" and not self.docker_bin:
            result.append("OPS_DOCKER_BIN 未设置")
        return result

    def now(self) -> datetime:
        return datetime.now(self.tz)

    def iso(self, moment: datetime | None = None) -> str:
        value = moment or self.now()
        return value.isoformat(timespec="seconds")
