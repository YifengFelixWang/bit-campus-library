"""受限执行器。

所有数据库工具调用都在这里集中构造参数数组，业务层只能提交动作名和受限参数，
不能拼接 shell 字符串。docker 模式下通过 docker exec 进入数据库容器执行；
local 模式下直接调用本机工具。命令结果中的口令一律脱敏后再写入任务日志。
"""

from __future__ import annotations

import re
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from typing import Iterable

from .config import Config


class ExecutorError(RuntimeError):
    """执行器无法启动或参数不合法。"""


@dataclass
class ExecResult:
    argv: list[str]
    display: str
    returncode: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = field(default=False)

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out

    def tail(self, limit: int = 4000) -> str:
        text = (self.stderr or self.stdout or "").strip()
        if len(text) > limit:
            text = text[-limit:]
        return text


class Executor:
    def __init__(self, config: Config) -> None:
        self.config = config
        self._secret = config.db_password

    # ---------------------------------------------------------------- 脱敏
    def mask(self, text: str) -> str:
        if self._secret:
            text = text.replace(self._secret, "******")
        return text

    def _mask_argv(self, argv: Iterable[str]) -> str:
        parts = [self.mask(str(item)) for item in argv]
        return " ".join(shlex.quote(part) for part in parts)

    # ---------------------------------------------------------------- 运行
    def _run(self, argv: list[str], timeout: int | None = None) -> ExecResult:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=timeout or self.config.command_timeout,
                encoding="utf-8",
                errors="replace",
            )
            timed_out = False
            code = completed.returncode
            out = completed.stdout or ""
            err = completed.stderr or ""
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            code = -1
            out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
            err = (exc.stderr or "") if isinstance(exc.stderr, str) else ""
            err = (err + "\n" if err else "") + "命令超时"
        except FileNotFoundError as exc:
            name = exc.filename or (argv[0] if argv else "命令")
            raise ExecutorError("找不到可执行程序：%s" % name) from exc
        duration = int((time.monotonic() - started) * 1000)
        return ExecResult(
            argv=argv,
            display=self._mask_argv(argv),
            returncode=code,
            stdout=out,
            stderr=err,
            duration_ms=duration,
            timed_out=timed_out,
        )

    def _docker_args(self, container: str, argv: list[str]) -> list[str]:
        if not container:
            raise ExecutorError("未配置数据库容器名")
        args = [self.config.docker_bin, "exec"]
        if self.config.db_os_user:
            args += ["-u", self.config.db_os_user]
        args += [container]
        args += argv
        return args

    def in_container(self, container: str, argv: list[str], timeout: int | None = None) -> ExecResult:
        """在数据库容器内执行 openGauss 工具。"""
        if self.config.exec_mode == "docker":
            if shutil.which(self.config.docker_bin) is None:
                raise ExecutorError("找不到 docker 客户端：%s" % self.config.docker_bin)
            return self._run(self._docker_args(container, argv), timeout)
        return self._run(argv, timeout)

    def docker(self, argv: list[str], timeout: int | None = None) -> ExecResult:
        """在运维服务所在主机执行 docker 客户端命令（如 inspect / cp）。"""
        if shutil.which(self.config.docker_bin) is None:
            raise ExecutorError("找不到 docker 客户端：%s" % self.config.docker_bin)
        return self._run([self.config.docker_bin] + argv, timeout)

    def docker_available(self) -> bool:
        try:
            return self._run([self.config.docker_bin, "version", "--format", "{{.Server.Version}}"], 15).ok
        except ExecutorError:
            return False

    def container_running(self, container: str) -> tuple[bool, str]:
        result = self.docker(["inspect", "-f", "{{.State.Running}}", container], 15)
        if not result.ok:
            return False, (result.tail(500) or "容器不存在")
        return result.stdout.strip() == "true", ""

    # ---------------------------------------------------------------- 数据库
    def _local_port(self, container: str | None) -> int:
        """local 模式下按数据目录映射到该节点的 SQL 端口；单实例回落到 OPS_DB_PORT。"""
        if self.config.standby_container and container == self.config.standby_container:
            return self.config.node_b_port
        if self.config.db_container and container == self.config.db_container:
            return self.config.node_a_port
        return self.config.db_port

    def _host_args(self, container: str | None = None) -> list[str]:
        """本机直连时用 TCP 指定地址与节点端口；docker 模式走容器内本地套接字。"""
        if self.config.exec_mode == "local":
            return ["-h", self.config.db_host, "-p", str(self._local_port(container))]
        return ["-p", str(self.config.db_port)]

    def gsql(self, sql: str, container: str | None = None, database: str | None = None,
             timeout: int | None = None) -> ExecResult:
        container = container or self.config.db_container
        argv = [
            "gsql",
            "-U", self.config.db_user,
            "-W", self.config.db_password,
            "-d", database or self.config.db_name,
            "-t", "-A", "-c", sql,
        ]
        argv = [argv[0]] + self._host_args(container) + argv[1:]
        return self.in_container(container, argv, timeout)

    def gsql_file(self, remote_path: str, container: str | None = None,
                  database: str | None = None, timeout: int | None = None) -> ExecResult:
        container = container or self.config.db_container
        argv = [
            "gsql",
            "-U", self.config.db_user,
            "-W", self.config.db_password,
            "-d", database or self.config.db_name,
            "-v", "ON_ERROR_STOP=1",
            "-f", remote_path,
        ]
        argv = [argv[0]] + self._host_args(container) + argv[1:]
        return self.in_container(container, argv, timeout)

    def gs_dump(self, remote_file: str, container: str | None = None) -> ExecResult:
        container = container or self.config.db_container
        argv = [
            "gs_dump",
            "-U", self.config.db_user,
            "-W", self.config.db_password,
            "-F", "c",
            "-f", remote_file,
            self.config.db_name,
        ]
        argv = [argv[0]] + self._host_args(container) + argv[1:]
        return self.in_container(container, argv)

    def gs_restore(self, remote_file: str, target_database: str,
                   container: str | None = None) -> ExecResult:
        container = container or self.config.db_container
        argv = [
            "gs_restore",
            "-U", self.config.db_user,
            "-W", self.config.db_password,
            "-d", target_database,
            "-e",
            remote_file,
        ]
        argv = [argv[0]] + self._host_args(container) + argv[1:]
        return self.in_container(container, argv)

    def gs_ctl(self, action: str, container: str, extra: list[str] | None = None,
               timeout: int | None = None) -> ExecResult:
        # docker 模式的容器内数据目录固定；local 模式下 container 就是该节点的 datadir
        datadir = container if self.config.exec_mode == "local" else self.config.database_datadir
        argv = ["gs_ctl", action, "-D", datadir]
        if extra:
            argv += extra
        return self.in_container(container, argv, timeout)

    # ---------------------------------------------------------------- 文件
    @staticmethod
    def safe_file_name(name: str) -> bool:
        return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.dump", name))

    def copy_from_container(self, container: str, remote_path: str, local_path: str) -> ExecResult:
        return self.docker(["cp", "%s:%s" % (container, remote_path), str(local_path)])

    def copy_to_container(self, local_path: str, container: str, remote_path: str) -> ExecResult:
        return self.docker(["cp", str(local_path), "%s:%s" % (container, remote_path)])
