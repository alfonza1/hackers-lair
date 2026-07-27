#!/usr/bin/env python3
"""Browser coverage for the static Hacker's Lair installation website."""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parent.parent
SITE = (ROOT / "site").resolve()
SITE_PREFIX = "/desktop"
WINDOWS_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
)
LINUX_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
)
MAC_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) "
    "AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15"
)


class SiteHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def translate_path(self, request_path: str) -> str:
        url_path = unquote(urlsplit(request_path).path)
        if url_path == SITE_PREFIX:
            url_path = f"{SITE_PREFIX}/"
        if not url_path.startswith(f"{SITE_PREFIX}/"):
            return str(SITE / "__missing__")
        relative = url_path.removeprefix(f"{SITE_PREFIX}/")
        candidate = (SITE / relative).resolve()
        if candidate != SITE and SITE not in candidate.parents:
            return str(SITE / "__missing__")
        if candidate.is_dir():
            candidate /= "index.html"
        return str(candidate)

    def send_error(
        self,
        code: int,
        message: str | None = None,
        explain: str | None = None,
    ) -> None:
        if code != 404:
            super().send_error(code, message, explain)
            return
        content = (SITE / "404.html").read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def release_fixture() -> dict:
    return {
        "tag_name": "v2.1.0-beta.2",
        "published_at": "2026-07-26T00:00:00Z",
        "body": "Verified static-site browser fixture.",
    }


def stub_release_metadata(page) -> None:
    page.route(
        "https://api.github.com/**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps([release_fixture()]),
        ),
    )


def assert_no_browser_errors(errors: list[str]) -> None:
    assert not errors, f"Browser console errors: {errors}"


def run() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}{SITE_PREFIX}/"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)

            windows_context = browser.new_context(
                viewport={"width": 390, "height": 844},
                user_agent=WINDOWS_USER_AGENT,
                reduced_motion="reduce",
                permissions=["clipboard-read", "clipboard-write"],
            )
            windows_page = windows_context.new_page()
            windows_errors: list[str] = []
            windows_page.on(
                "console",
                lambda message: windows_errors.append(message.text)
                if message.type == "error"
                else None,
            )
            windows_page.on("pageerror", lambda error: windows_errors.append(str(error)))
            stub_release_metadata(windows_page)
            windows_page.goto(origin, wait_until="networkidle")
            windows_page.get_by_role("link", name="Install from terminal").click()
            install_top = windows_page.locator("#install").evaluate(
                "element => element.getBoundingClientRect().top"
            )
            header_bottom = windows_page.locator(".site-header").evaluate(
                "element => element.getBoundingClientRect().bottom"
            )
            assert install_top >= header_bottom
            expect(
                windows_page.get_by_role("button", name="Windows")
            ).to_have_attribute("aria-pressed", "true")
            expect(
                windows_page.locator('[data-platform-panel="windows"]')
            ).to_be_visible()
            assert not windows_page.evaluate(
                "document.documentElement.scrollWidth > "
                "document.documentElement.clientWidth"
            )
            windows_copy = windows_page.locator(
                '[data-platform-panel="windows"] .copy-command'
            )
            windows_copy.click()
            expect(windows_copy).to_have_text("Copied")
            assert "install.ps1 | iex" in windows_page.evaluate(
                "navigator.clipboard.readText()"
            )
            assert_no_browser_errors(windows_errors)

            linux_context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent=LINUX_USER_AGENT,
                reduced_motion="reduce",
            )
            linux_page = linux_context.new_page()
            linux_errors: list[str] = []
            linux_page.on(
                "console",
                lambda message: linux_errors.append(message.text)
                if message.type == "error"
                else None,
            )
            stub_release_metadata(linux_page)
            linux_page.goto(origin, wait_until="networkidle")
            expect(
                linux_page.get_by_role("button", name="Linux")
            ).to_have_attribute("aria-pressed", "true")
            linux_panel = linux_page.locator('[data-platform-panel="linux"]')
            expect(linux_panel).to_be_visible()
            expect(linux_panel).to_contain_text("choose your distribution")
            for heading in ["Debian / Ubuntu", "Fedora / RHEL", "Distro-neutral"]:
                expect(linux_panel.get_by_role("heading", name=heading)).to_be_visible()
            assert linux_panel.locator("text=sha256sum").count() == 3
            linux_page.set_viewport_size({"width": 900, "height": 620})
            assert not linux_page.evaluate(
                "document.documentElement.scrollWidth > "
                "document.documentElement.clientWidth"
            )
            assert_no_browser_errors(linux_errors)

            unsupported_context = browser.new_context(
                user_agent=MAC_USER_AGENT,
                reduced_motion="reduce",
            )
            unsupported_context.add_init_script(
                """
                Object.defineProperty(navigator, 'platform', {
                  configurable: true,
                  get: () => 'MacIntel',
                });
                """
            )
            unsupported_page = unsupported_context.new_page()
            stub_release_metadata(unsupported_page)
            unsupported_page.goto(origin, wait_until="networkidle")
            expect(
                unsupported_page.locator('[data-platform-panel="unsupported"]')
            ).to_be_visible()
            expect(
                unsupported_page.get_by_role("button", name="Windows")
            ).to_have_attribute("aria-pressed", "false")
            expect(
                unsupported_page.get_by_role("button", name="Linux")
            ).to_have_attribute("aria-pressed", "false")
            unsupported_page.get_by_role("button", name="Linux").click()
            expect(
                unsupported_page.locator('[data-platform-panel="linux"]')
            ).to_be_visible()

            no_script_context = browser.new_context(java_script_enabled=False)
            no_script_page = no_script_context.new_page()
            no_script_page.goto(origin, wait_until="domcontentloaded")
            expect(
                no_script_page.locator('[data-platform-panel="windows"]')
            ).to_be_visible()
            expect(
                no_script_page.locator('[data-platform-panel="linux"]')
            ).to_be_visible()
            expect(
                no_script_page.locator('[data-platform-panel="unsupported"]')
            ).to_be_hidden()

            missing_page = windows_context.new_page()
            missing_failures: list[tuple[int, str]] = []
            missing_page.on(
                "response",
                lambda response: missing_failures.append(
                    (response.status, response.url)
                )
                if response.status >= 400
                else None,
            )
            missing_url = f"{origin}docs/not-a-real-page"
            response = missing_page.goto(
                missing_url,
                wait_until="networkidle",
            )
            assert response is not None and response.status == 404
            assert missing_failures == [(404, missing_url)]
            assert "Lair Mono" in missing_page.evaluate(
                "getComputedStyle(document.body).fontFamily"
            )
            expect(
                missing_page.get_by_role("link", name="Getting started")
            ).to_have_attribute("href", f"{SITE_PREFIX}/getting-started/")

            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)

    print(
        "Static site Playwright passed: Windows, Linux distro choice, unsupported "
        "platform, copy, no-JavaScript, mobile layout, and nested 404."
    )


if __name__ == "__main__":
    run()
