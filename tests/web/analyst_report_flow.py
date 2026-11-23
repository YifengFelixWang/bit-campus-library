"""Run against the integrated library with D's demo seed and an initialized analyst01."""
import csv
import getpass
import json
import os
from collections import Counter

from playwright.sync_api import expect, sync_playwright


def check():
    base = os.getenv("LIBRARY_WEB_URL", "http://127.0.0.1:8080").rstrip("/")
    password = os.getenv("IAM_SEED_ANALYST01_PASSWORD") or getpass.getpass("analyst01: ")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE"))
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base)
        page.locator("#loginBtn").click()
        page.locator("#loginUsername").fill("analyst01")
        page.locator("#loginPassword").fill(password)
        page.locator("#loginForm button[type=submit]").click()
        expect(page.locator("#userName")).to_have_text("analyst01", timeout=20000)
        page.goto(base + "/#console/overview")
        with page.expect_response(base + "/api/reports/sync") as sync_response:
            page.locator('[data-tab="report-stats"]').click()
        assert sync_response.value.ok, sync_response.value.status
        sources = sync_response.value.json()["sources"]
        loan = next(s for s in sources if s["sourceName"] == "loan")
        assert loan["status"] == "OK" and loan["lastSuccessAt"] and not loan["lastError"], loan
        expect(page.locator("#rsSyncStatus tbody tr").filter(has_text="loan")).to_contain_text("OK")
        stats = page.locator("#rsTable tbody tr").filter(has_text="文学")
        expect(stats).to_have_count(1)
        total, open_count = map(int, stats.locator("td").all_text_contents()[1:])
        assert total >= open_count > 0, (total, open_count)

        def select_filters(prefix):
            page.locator("#" + prefix + "Category").select_option(label="文学")
            page.locator("#" + prefix + "Book").select_option(label="红楼梦")
            page.locator("#" + prefix + "Status").select_option("BORROWED")
            expect(page.locator("#" + prefix + "SeedHint")).to_be_hidden()

        page.locator('[data-tab="report-query"]').click()
        select_filters("rq")
        with page.expect_response(base + "/api/reports/query") as query_response:
            page.locator("#rqSearch").click()
        assert query_response.value.ok, query_response.value.status
        results = query_response.value.json()["rows"]
        assert results, "No borrowed copies of 红楼梦 in the report projection"
        rows = page.locator("#rqTable tbody tr")
        expect(rows).to_have_count(len(results))
        sql = page.locator("#rqSql").input_value()
        assert "?" in sql and "BORROWED" not in sql, sql
        assert json.loads(page.locator("#rqParams").input_value()) == [1, 1, "BORROWED"]
        displayed = [tuple(row.locator("td").all_text_contents()) for row in rows.all()]
        assert all(category == "文学" and title == "红楼梦" and reader and time and status == "BORROWED"
                   for category, title, reader, time, status in displayed), displayed

        page.locator('[data-tab="report-export"]').click()
        select_filters("re")
        with page.expect_download() as downloading:
            page.locator("#reDownload").click()
        download = downloading.value
        assert download.suggested_filename == "report.csv"
        with download.path().open(encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.reader(csv_file)
            assert next(reader) == ["categoryName", "title", "readerName", "borrowedAt", "status"]
            assert Counter(map(tuple, reader)) == Counter(displayed), "CSV differs from displayed query rows"
        assert not errors, errors
        print("Passed analyst login, loan synchronization, statistics, filtered query and matching CSV export")
        browser.close()


if __name__ == "__main__":
    check()
