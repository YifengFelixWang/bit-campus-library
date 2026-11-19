"""Browser integration check. Run against the local development library with both readers initialized."""
import getpass
import os
from playwright.sync_api import expect, sync_playwright


def check():
    base = os.getenv("LIBRARY_WEB_URL", "http://127.0.0.1:8080").rstrip("/")
    passwords = {name: os.getenv(f"IAM_SEED_{name.upper()}_PASSWORD") or getpass.getpass(name + ": ")
                 for name in ("reader01", "reader02")}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE"))
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/#library")
        grid = page.locator("#allBookGrid")
        public = page.request.get(base + "/api/catalog/books?size=1")
        assert public.ok
        book = public.json()["data"]["items"][0]
        search = page.locator("#bookQueryForm")
        search.get_by_placeholder("如：数据库", exact=True).fill(book["title"])
        author = (book.get("authorNames") or "").split(";")[0]
        search.get_by_placeholder("如：王珊").fill(author)
        with page.expect_response(lambda response: "/api/catalog/books/search?" in response.url
                                  and "title=" in response.url) as response:
            search.locator("#allSearchSubmit").click()
        assert response.value.ok
        result = response.value.json()["data"]
        assert any(item["bookId"] == book["bookId"] for item in result["items"])
        expect(grid).to_contain_text(book["title"])
        print("Passed catalog search and rendering")

        # Use the same token as the browser page and compare the two independent DB pools.
        def identity(path):
            return page.evaluate("""async path => {
                const response = await fetch(path, {headers: {Authorization: "Bearer " + sessionStorage.getItem("tata-token")}});
                if (!response.ok) throw new Error("Identity query failed: " + response.status);
                return response.json();
            }""", path)

        page.locator("#loginBtn").click()
        for name, password in passwords.items():
            page.locator("#loginUsername").fill(name)
            page.locator("#loginPassword").fill(password)
            page.locator("#loginForm button[type=submit]").click()
            expect(page.locator("#userName")).to_have_text(name, timeout=20000)
            assert identity("/users/me")["username"] == name
            catalog = identity("/api/catalog/whoami")["database"]
            loan = identity("/api/me")["database"]
            assert catalog["currentUser"] == catalog["sessionUser"] == "db_catalog_" + name
            assert loan["current_user"] == loan["session_user"] == "db_loan_" + name
            page.locator("#userName").click()
            expect(page.locator("#accountMenu")).to_contain_text("db_loan_" + name)
            page.locator("#menuSwitch").click()
            print("Passed browser login and both database sessions:", name)
        page.locator("#loginUsername").fill("reader02")
        page.locator("#loginPassword").fill("invalid-demo-input")
        page.locator("#loginForm button[type=submit]").click()
        expect(page.locator("#loginError")).to_contain_text("账号或密码不正确")
        expect(page.locator("#userName")).to_have_count(0)
        assert not page.evaluate('sessionStorage.getItem("tata-token")')
        assert not errors, errors
        print("Passed wrong-password and account-switch checks")
        browser.close()


if __name__ == "__main__":
    check()
