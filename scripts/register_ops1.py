"""Create the bookshop's ops1 account using the local IAM database configuration."""
import getpass
import os
from pathlib import Path
import shutil
import subprocess
import sys

from run_library import ROOT, read_env


def register(password):
    if not password.strip() or not 12 <= len(password.encode("utf-16-le")) // 2 <= 256:
        raise ValueError("密码长度应为 12 到 256 个字符。")
    config = {**read_env(ROOT / "database/opengauss/.env"), **os.environ}
    db_password = config.get("IAM_DB_PASSWORD") or config.get("LIBRARY_LOCAL_PASSWORD")
    if not db_password:
        raise ValueError("请先在 database/opengauss/.env 中填写书屋使用的数据库密码。")
    env = os.environ.copy()
    if config.get("JAVA_HOME"):
        env["JAVA_HOME"] = config["JAVA_HOME"]
        env["PATH"] = str(Path(env["JAVA_HOME"]) / "bin") + os.pathsep + env["PATH"]
    maven = config.get("MAVEN_CMD") or shutil.which("mvn", path=env["PATH"])
    if not maven:
        raise ValueError("找不到 Maven，请在书屋的 .env 中配置 MAVEN_CMD。")
    env["IAM_DB_PASSWORD"] = db_password
    env["IAM_DB_URL"] = (config.get("IAM_DB_URL") or config.get("LIBRARY_JDBC_URL")
                         or "jdbc:opengauss://127.0.0.1:15432/library")
    env["IAM_REGISTER_OPS1_PASSWORD"] = password
    command = [maven, "-q", "-B", "-ntp", "-f", str(ROOT / "services/identity-service/pom.xml")]
    if config.get("MAVEN_REPO_LOCAL"):
        command.append("-Dmaven.repo.local=" + config["MAVEN_REPO_LOCAL"])
    command.extend(["-Dspring-boot.run.arguments=--register-ops1", "spring-boot:run"])
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode or not any(line in (b"OPS1_CREATED", b"OPS1_ALREADY_REGISTERED")
                                    for line in result.stdout.splitlines()):
        if b"OPS1_CONFLICT" in result.stdout:
            raise ValueError("库里已有同名账号，但角色或启用状态不同，请联系书屋管理员。")
        raise ValueError("创建未完成。请确认数据库已启动，且本机书屋配置的 Java、Maven 和数据库连接可用。")
    return b"OPS1_CREATED" in result.stdout.splitlines()


def main():
    print("创建 BIT 书屋运维账号 ops1。输入密码时屏幕不会显示字符。", flush=True)
    password = getpass.getpass("请设置书屋登录密码（12 到 256 个字符）：")
    if password != getpass.getpass("请再输入一次："):
        raise ValueError("两次输入的密码不一致，请重新运行。")
    print("正在连接书屋并创建账号，请稍候。", flush=True)
    if register(password):
        print("账号已创建。请在书屋退出当前账号，再用 ops1 和刚设置的密码登录。")
    else:
        print("ops1 已经注册过了，请使用原来的密码登录。")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
    except (EOFError, KeyboardInterrupt):
        sys.exit("已取消。")
