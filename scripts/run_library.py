"""Start identity, catalog, loan, report, and the web process for the shared campus library project."""
import argparse
import json
import os
import secrets
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from contextlib import ExitStack
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
JARS = {
    "identity": "identity-service-1.0.0.jar",
    "catalog": "catalog-service-0.1.0.jar",
    "loan": "loan-service-1.0.0.jar",
    "report": "report-service-1.0.0.jar",
}
PORTS = {"web": 8080, "identity": 18081, "catalog": 8082, "loan": 18083, "report": 18084}

def read_env(path):
    values = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in (chr(34), chr(39)):
                    value = value[1:-1]
                values[key.strip()] = value
    return values

def settings(path):
    env = {**read_env(path), **os.environ}
    shared = env.get("LIBRARY_LOCAL_PASSWORD", "")
    for role in ("IAM_DB", "CATALOG_DB_READER01", "CATALOG_DB_READER02", "CATALOG_DB_LIBRARIAN01",
                 "LOAN_DB_READER01", "LOAN_DB_READER02", "LOAN_DB_LIBRARIAN01",
                 "REPORT_DB_ANALYST", "REPORT_DB_SYNC"):
        key = role + "_PASSWORD"
        env[key] = env.get(key) or shared
        if not env[key]:
            raise ValueError(f"Set {key} or LIBRARY_LOCAL_PASSWORD in {path}")
    urls = {name: f"http://127.0.0.1:{port}" for name, port in PORTS.items()}
    env["REPORT_SYNC_TOKEN"] = env.get("REPORT_SYNC_TOKEN") or secrets.token_urlsafe(32)
    env.update(IDENTITY_URL=urls["identity"] + "/users/me", IDENTITY_SERVICE_URL=urls["identity"],
               LOAN_SERVICE_URL=urls["loan"], CATALOG_SERVICE_URL=urls["catalog"],
               REPORT_SERVICE_URL=urls["report"],
               CATALOG_COVER_DIR=str(ROOT / "web/covers"), SERVER_ADDRESS="127.0.0.1")
    for key in ("IAM_DB_URL", "CATALOG_DB_URL", "LOAN_DB_URL"):
        env.setdefault(key, env.get("LIBRARY_JDBC_URL") or "jdbc:opengauss://127.0.0.1:15432/library")
    return env

def start(stack, command, env, name):
    log = ROOT / "target/run" / (name + ".log")
    log.parent.mkdir(parents=True, exist_ok=True)
    output = stack.enter_context(log.open("wb"))
    process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    def stop():
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    stack.callback(stop)
    return process

def check_processes(processes):
    for name, process in processes.items():
        if process.poll() is not None:
            raise RuntimeError(f"{name} stopped. See target/run/{name}.log")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / "database/opengauss/.env")
    parser.add_argument("--build", action="store_true", help="Rebuild every Java application")
    args = parser.parse_args()
    env = settings(args.env_file)
    java_dir = Path(env["JAVA_HOME"]) / "bin" if env.get("JAVA_HOME") else None
    if java_dir:
        env["PATH"] = str(java_dir) + os.pathsep + env["PATH"]
    java = shutil.which("java", path=env["PATH"])
    if not java:
        raise RuntimeError("Java 21 is required. Set JAVA_HOME.")
    for name, port in PORTS.items():
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as error:
                raise RuntimeError(f"Port {port} ({name}) is in use.") from error
    jars = {}
    for name, filename in JARS.items():
        service = ROOT / "services" / (name + "-service")
        jar = service / "target" / filename
        if args.build or not jar.exists():
            maven = env.get("MAVEN_CMD") or shutil.which("mvn", path=env["PATH"])
            if not maven:
                raise RuntimeError("Building requires Maven. Set MAVEN_CMD or add mvn to PATH.")
            command = [maven, "-B", "-ntp", "-f", str(service / "pom.xml"), "package"]
            if env.get("MAVEN_REPO_LOCAL"):
                command.insert(1, "-Dmaven.repo.local=" + env["MAVEN_REPO_LOCAL"])
            subprocess.run(command, env=env, cwd=ROOT, check=True)
        jars[name] = jar
    paths = {"identity": "/auth/ready", "catalog": "/api/catalog/health", "loan": "/api/health",
             "report": "/api/reports/health", "web": "/"}
    with ExitStack() as stack:
        processes = {name: start(stack, [java, "-jar", str(jar), f"--server.port={PORTS[name]}"],
                                 env, name) for name, jar in jars.items()}
        processes["web"] = start(stack, [sys.executable, "-u", str(ROOT / "deploy/dev-server.py"),
                                         str(PORTS["web"])], env, "web")
        pending = set(processes)
        deadline = time.monotonic() + 90
        while pending:
            check_processes(processes)
            for name in list(pending):
                try:
                    with urlopen(f"http://127.0.0.1:{PORTS[name]}{paths[name]}", timeout=1) as response:
                        health_field = {"catalog": "status", "report": "database"}.get(name)
                        if health_field and json.load(response).get(health_field) != "UP":
                            continue
                        pending.remove(name)
                except (URLError, TimeoutError, ConnectionError):
                    pass
            if pending and time.monotonic() >= deadline:
                raise RuntimeError("Services did not become ready: " + ", ".join(sorted(pending)))
            time.sleep(0.3)
        print("Ready: http://127.0.0.1:8080/   Ctrl+C to stop.", flush=True)
        while True:
            time.sleep(2)
            check_processes(processes)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
