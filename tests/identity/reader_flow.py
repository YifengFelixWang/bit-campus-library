"""Exercise real login and two independent loan DB sessions without printing credentials."""
import getpass
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def call(base, path, *, credentials=None, token=None):
    headers = {"Accept": "application/json"}
    body = None
    if credentials is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(credentials).encode()
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    req = Request(base.rstrip("/") + path, data=body, headers=headers)
    try:
        with urlopen(req, timeout=18) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, {}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    identity = os.environ.get("IDENTITY_API", "http://127.0.0.1:8081")
    loan = os.environ.get("LOAN_SERVICE_URL", "http://127.0.0.1:8083")
    sessions = []
    for user_id, username in [(1, "reader01"), (2, "reader02")]:
        password = os.environ.get("IAM_SEED_" + username.upper() + "_PASSWORD")
        if not password:
            password = getpass.getpass(username + " application password: ")
        status, response = call(identity, "/auth/login", credentials={"username": username, "password": password})
        require(status == 200 and response.get("accessToken"), f"{username} login HTTP {status}")
        token = response["accessToken"]
        status, me = call(identity, "/users/me", token=token)
        require(status == 200 and me.get("id") == user_id and me.get("username") == username
                and "READER" in me.get("roles", []), f"{username} /users/me mismatch, HTTP {status}")
        sessions.append((user_id, username, token))

    # Alternate both active sessions and revisit the first to catch accidental identity reuse.
    for user_id, username, token in [*sessions, sessions[0]]:
        expected = "db_loan_" + username
        for base, path in [(loan, "/api/me"), (identity, "/demo/loan-identity")]:
            status, data = call(base, path, token=token)
            db = data.get("database", {})
            require(status == 200 and data.get("id") == user_id and data.get("username") == username
                    and db.get("current_user") == db.get("session_user") == expected,
                    f"{username} {path} did not report the expected DB session, HTTP {status}")
        print(f"{username}: current_user={expected}, session_user={expected}")
    for base, path in [(identity, "/users/me"), (loan, "/api/me")]:
        require(call(base, path)[0] == 401, f"{path} accepted a missing token")
        require(call(base, path, token="invalid-test-token")[0] == 401, f"{path} accepted an invalid token")
    print("PASS: both logins, both loan DB identities, account switching and token rejection")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, URLError, TimeoutError, ValueError, EOFError) as exc:
        sys.exit("FAIL: " + str(exc))
