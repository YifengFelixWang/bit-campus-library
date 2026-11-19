"""Provision D's nine login roles on a fresh openGauss cluster using gsql."""
import argparse
import getpass
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="gsql host (default: local Unix socket)")
    parser.add_argument("--port", default="5432", type=int)
    parser.add_argument("--user", default="gaussdb", help="initialization account")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.exit(1, "Run this command in an interactive terminal.\n")

    password = getpass.getpass("New local password for the nine database roles: ")
    if not password or any(ch in password for ch in "\r\n\x00"):
        parser.exit(1, "Enter a nonempty, single-line password.\n")
    if getpass.getpass("Confirm database role password: ") != password:
        parser.exit(1, "Passwords do not match.\n")

    template = (Path(__file__).parent / "dist" / "001_roles.sql").read_text(encoding="utf-8")
    # Escape both delimiters used by openGauss escape string literals.
    literal = "E'" + password.replace("\\", "\\\\").replace("'", "''") + "'"
    sql = "BEGIN;\n" + template.replace(":runtime_password", literal) + "\nCOMMIT;\n"
    command = ["gsql", "-X", "-v", "ON_ERROR_STOP=1", "-p", str(args.port),
               "-U", args.user, "-d", "postgres"]
    if args.host:
        command.extend(["-h", args.host])
    try:
        result = subprocess.run(command, input=sql.encode("utf-8"),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        parser.exit(1, "Install the openGauss gsql client and add it to PATH.\n")
    if result.returncode:
        parser.exit(1, "Role creation failed. Check admin access to postgres, the password policy, "
                    "and whether the roles already exist.\n")
    print("Created nine openGauss login roles in the maintenance database.")


if __name__ == "__main__":
    main()
