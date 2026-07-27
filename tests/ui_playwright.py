#!/usr/bin/env python3
"""Browser-level smoke coverage for the real Hacker's Lair local service."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIRECTORY = ROOT / "out"
IDENTITY_TIMEOUT_SECONDS = 15


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class ListeningFixture:
    def __init__(self) -> None:
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen()
        self.port = int(self.socket.getsockname()[1])
        self._closed = threading.Event()
        self._thread = threading.Thread(target=self._accept_connections, daemon=True)

    def _accept_connections(self) -> None:
        self.socket.settimeout(0.2)
        while not self._closed.is_set():
            try:
                connection, _address = self.socket.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            connection.close()

    def __enter__(self) -> "ListeningFixture":
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._closed.set()
        self.socket.close()
        self._thread.join(timeout=1)


def wait_for_identity(identity_file: Path, process: subprocess.Popen[bytes]) -> dict:
    deadline = time.monotonic() + IDENTITY_TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Local service exited with code {process.returncode}.")
        try:
            identity = json.loads(identity_file.read_text(encoding="utf-8"))
            with urllib.request.urlopen(
                f"http://127.0.0.1:{identity['port']}/api/identity",
                timeout=1,
            ) as response:
                actual = json.loads(response.read().decode("utf-8"))
            if actual["app"] == "hackers-lair" and actual["nonce"] == identity["nonce"]:
                return identity
        except (OSError, KeyError, ValueError) as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"Local service identity was not ready: {last_error}")


def shutdown_service(identity: dict) -> None:
    request = urllib.request.Request(
        f"http://127.0.0.1:{identity['port']}/api/service/shutdown",
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Lair-Token": identity["token"],
        },
    )
    with urllib.request.urlopen(request, timeout=3):
        pass


def write_projects(data_directory: Path, projects: list[dict]) -> None:
    config = {
        "configVersion": 1,
        "$schema": "./projects.schema.json",
        "projects": projects,
    }
    (data_directory / "projects.json").write_text(
        json.dumps(config, indent=2),
        encoding="utf-8",
    )


def write_script_fixture(data_directory: Path) -> str:
    scripts_directory = data_directory / "script-fixtures"
    scripts_directory.mkdir()
    script_name = "ui-smoke-script.au3"
    (scripts_directory / script_name).write_text(
        "; Compact action tray UI fixture.\n",
        encoding="utf-8",
    )
    config = {
        "configVersion": 1,
        "scriptsDir": str(scripts_directory),
        "autoItExe": "",
        "descriptions": {
            script_name: "Verify the compact Scripts action tray.",
        },
    }
    (data_directory / "scripts.json").write_text(
        json.dumps(config, indent=2),
        encoding="utf-8",
    )
    return script_name


def project_fixture(
    *,
    name: str,
    directory: Path,
    port: int,
    component_name: str,
) -> dict:
    return {
        "name": name,
        "type": "Node",
        "components": [
            {
                "name": component_name,
                "role": "frontend",
                "cwd": str(directory),
                "command": "node -e \"setInterval(() => {}, 1000)\"",
                "match": f"ui-smoke-{component_name}",
                "port": port,
                "detectByPort": True,
            }
        ],
    }


def assert_empty_state(page) -> None:
    page.goto(page.url, wait_until="networkidle")
    empty_state = page.locator("#emptyState")
    expect(empty_state).to_be_visible()
    expect(empty_state.get_by_text("Set up with wizard")).to_be_visible()
    expect(empty_state.get_by_text("Copy prompt for your AI agent")).to_be_visible()
    expect(empty_state.get_by_text("Recommended", exact=True)).to_be_visible()
    setup_paths = empty_state.locator(".onboarding-paths > .onboarding-path")
    expect(setup_paths.nth(0)).to_contain_text("Agent-assisted")
    expect(setup_paths.nth(1)).to_contain_text("Guided setup")


def assert_project_editor_controls(page, selected_folder: Path) -> None:
    page.get_by_role("button", name="Add Project").click()
    editor = page.locator("#projectEditor")
    expect(editor).to_be_visible()
    page.get_by_role("button", name="Close project editor").click()
    expect(editor).to_be_hidden()

    page.route(
        "**/api/dialog/workspace-folders",
        lambda route: route.fulfill(json={"folders": [str(selected_folder)]}),
    )
    page.get_by_role("button", name="Add Project").click()
    editor.get_by_role("button", name="Choose Folder").click()
    expect(editor.locator('[data-editor-field="cwd"]')).to_have_value(str(selected_folder))
    editor.get_by_role("button", name="Cancel").click()
    expect(editor).to_be_hidden()
    page.unroute("**/api/dialog/workspace-folders")


def assert_project_port_conflict(
    page,
    selected_folder: Path,
    occupied_port: int,
    console_errors: list[str],
) -> None:
    page.get_by_role("button", name="Add Project").click()
    editor = page.locator("#projectEditor")
    editor.locator("#editorProjectName").fill("Occupied Port Fixture")
    editor.locator('[data-editor-field="name"]').fill("web")
    editor.locator('[data-editor-field="cwd"]').fill(str(selected_folder))
    editor.locator('[data-editor-field="command"]').fill("npm run dev")
    editor.locator('[data-editor-field="ports"]').fill(str(occupied_port))
    editor.get_by_role("button", name="Save Project").click()

    conflict = editor.locator("#projectEditorError")
    expect(conflict).to_contain_text(f"Port {occupied_port} is occupied by")
    expect(conflict).to_contain_text("PID")
    expect(editor).to_be_visible()
    editor.get_by_role("button", name="Cancel").click()
    expect(editor).to_be_hidden()
    expected_network_errors = [
        error
        for error in console_errors
        if "Failed to load resource" in error and "409" in error
    ]
    assert len(expected_network_errors) == 1
    console_errors.remove(expected_network_errors[0])


def assert_target_states(page, live_port: int, dormant_port: int) -> None:
    page.reload(wait_until="networkidle")
    live = page.locator('[data-card-kind="project"][data-name="Live Fixture"]')
    dormant = page.locator('[data-card-kind="project"][data-name="Dormant Fixture"]')
    expect(live).to_be_visible(timeout=15_000)
    expect(dormant).to_be_visible(timeout=15_000)
    expect(live).to_have_class(re.compile(r"\blive\b"))
    expect(dormant).to_have_class(re.compile(r"\bdormant\b.*\bcompact\b"))
    expect(live.get_by_text("DETECTED", exact=True)).to_be_visible()
    expect(live.get_by_text(f"localhost:{live_port}", exact=True)).to_be_visible()
    expect(dormant.get_by_text("PORTS", exact=True)).to_be_visible()
    expect(dormant.locator(".configured-port-chip")).to_have_text(f":{dormant_port}")
    expect(dormant.get_by_text("DETECTED", exact=True)).to_have_count(0)

    live_actions = live.locator(".action-cluster .action")
    expect(live_actions).to_have_count(1)
    expect(live_actions).to_have_text("TERMINATE")
    expect(live_actions).to_be_enabled()
    expect(live.get_by_role("button", name="INITIATE", exact=True)).to_have_count(0)

    dormant_actions = dormant.locator(".action-cluster .action")
    expect(dormant_actions).to_have_count(1)
    expect(dormant_actions).to_have_text("INITIATE")
    expect(dormant_actions).to_be_enabled()
    expect(dormant.get_by_role("button", name="TERMINATE", exact=True)).to_have_count(0)

    for card, actions in ((live, live_actions), (dormant, dormant_actions)):
        tray_box = card.locator(".action-cluster").bounding_box()
        action_box = actions.bounding_box()
        assert tray_box is not None and action_box is not None
        assert tray_box["width"] <= action_box["width"] + 20

    assert "N/A" not in page.locator("body").inner_text()


def assert_port_signal_action_tray(page, live_port: int) -> None:
    page.get_by_role("tab", name="Port Signals", exact=True).click()
    signal = page.locator('[data-card-kind="process"]').filter(
        has_text=f":{live_port}"
    )
    expect(signal).to_be_visible(timeout=15_000)
    actions = signal.locator(".action-cluster .action")
    expect(actions).to_have_count(1)
    expect(actions).to_have_text("TERMINATE")
    tray_box = signal.locator(".action-cluster").bounding_box()
    action_box = actions.bounding_box()
    assert tray_box is not None and action_box is not None
    assert tray_box["width"] <= action_box["width"] + 20
    page.get_by_role("tab", name="Targets", exact=True).click()


def assert_script_action_tray(page, script_name: str) -> None:
    page.get_by_role("tab", name="Scripts", exact=True).click()
    script = page.locator('[data-card-kind="script"]').filter(
        has_text=script_name.removesuffix(".au3")
    )
    expect(script).to_be_visible(timeout=15_000)
    actions = script.locator(".action-cluster .action")
    expect(actions).to_have_count(1)
    expect(actions).to_have_text("INITIATE")
    tray_box = script.locator(".action-cluster").bounding_box()
    action_box = actions.bounding_box()
    assert tray_box is not None and action_box is not None
    assert tray_box["width"] <= action_box["width"] + 20
    page.get_by_role("tab", name="Targets", exact=True).click()


def assert_minimal_update_controls(page) -> None:
    expect(page.locator("#updateBanner")).to_have_count(0)
    update_trigger = page.locator("#updateAvailableTrigger")
    expect(update_trigger).to_be_hidden()
    release_notes = page.get_by_role("button", name="Release notes")
    expect(release_notes).to_be_hidden()

    page.evaluate("window.__lairUpdateListener(window.__availableUpdate)")
    expect(update_trigger).to_be_visible()
    expect(update_trigger).to_contain_text("v2.1.0-beta.3")
    update_trigger.click()

    dialog = page.get_by_role("dialog", name="Update available")
    expect(dialog).to_be_visible()
    expect(dialog).to_contain_text(
        "v2.1.0-beta.3 is available."
    )
    expect(dialog.locator("#updateCommand")).to_have_text(
        "irm https://hackerslairhq.github.io/desktop/install.ps1 | iex"
    )
    expect(dialog.locator("#releaseNotesBody")).to_have_count(0)
    expect(dialog.locator("#updateCurrentVersion")).to_have_count(0)
    expect(dialog.locator("#updateChannel")).to_have_count(0)
    expect(dialog.locator("#updateStatus")).to_have_count(0)
    dialog.get_by_role("button", name="Copy command").click()
    expect(page.locator("#toast")).to_have_text("Update command copied.")
    dialog.get_by_role("button", name="Close", exact=True).click()
    expect(dialog).to_be_hidden()

    page.set_viewport_size({"width": 900, "height": 620})
    update_trigger.click()
    dialog_box = dialog.bounding_box()
    assert dialog_box is not None
    assert dialog_box["x"] >= 0 and dialog_box["y"] >= 0
    assert dialog_box["x"] + dialog_box["width"] <= 900
    assert dialog_box["y"] + dialog_box["height"] <= 620
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    page.set_viewport_size({"width": 1440, "height": 900})


def assert_settings_panel(page, scripts_supported: bool) -> None:
    settings = page.get_by_role("button", name="Settings", exact=True)
    expect(settings).to_be_visible()
    settings.click()

    popover = page.locator("#settingsPopover")
    expect(popover).to_be_visible()
    for theme in ["phosphor", "ultraviolet", "ice", "volt", "ghost"]:
        page.locator("html").evaluate("(root, value) => { root.dataset.theme = value; }", theme)
        option_style = page.locator("#themePreference option").first.evaluate(
            """option => {
                const style = getComputedStyle(option);
                const luminance = color => {
                    const channels = color.match(/[\\d.]+/g).slice(0, 3).map(value => {
                        const normalized = Number(value) / 255;
                        return normalized <= 0.04045
                            ? normalized / 12.92
                            : ((normalized + 0.055) / 1.055) ** 2.4;
                    });
                    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
                };
                const foreground = luminance(style.color);
                const background = luminance(style.backgroundColor);
                const contrastRatio = (Math.max(foreground, background) + 0.05)
                    / (Math.min(foreground, background) + 0.05);
                const rootStyle = getComputedStyle(document.documentElement);
                const surface = rootStyle.getPropertyValue('--panel-solid').trim();
                const resolveColor = value => {
                    const probe = document.createElement('span');
                    probe.style.color = value;
                    document.body.append(probe);
                    const resolved = getComputedStyle(probe).color;
                    probe.remove();
                    return resolved;
                };
                const surfaceLuminance = luminance(resolveColor(surface));
                const tokenContrastRatios = Object.fromEntries(
                    ['--text', '--muted', '--dim', '--green', '--cyan', '--amber', '--red']
                        .map(token => {
                            const tokenLuminance = luminance(resolveColor(
                                rootStyle.getPropertyValue(token).trim()
                            ));
                            const ratio = (Math.max(tokenLuminance, surfaceLuminance) + 0.05)
                                / (Math.min(tokenLuminance, surfaceLuminance) + 0.05);
                            return [token, ratio];
                        })
                );
                return {
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    contrastRatio,
                    tokenContrastRatios,
                };
            }"""
        )
        assert option_style["backgroundColor"] not in {
            "transparent",
            "rgba(0, 0, 0, 0)",
        }, f"{theme} option background is transparent: {option_style}"
        assert (
            option_style["color"] != option_style["backgroundColor"]
        ), f"{theme} option text matches its background: {option_style}"
        assert (
            option_style["contrastRatio"] >= 4.5
        ), f"{theme} option contrast is below WCAG AA: {option_style}"
        if theme in {"ultraviolet", "volt"}:
            assert all(
                ratio >= 4.5
                for ratio in option_style["tokenContrastRatios"].values()
            ), f"{theme} has a token below WCAG AA: {option_style}"
    page.locator("html").evaluate("(root) => { root.dataset.theme = 'phosphor'; }")
    expect(page.locator("#themePreference")).to_have_value("phosphor")
    page.locator("#themePreference").select_option("ice")
    expect(page.locator("html")).to_have_attribute("data-theme", "ice")
    expect(page.locator("#densityPreference")).to_have_value("comfortable")
    page.locator("#densityPreference").select_option("compact")
    expect(page.locator("html")).to_have_attribute("data-density", "compact")
    page.locator("#motionPreference").select_option("reduced")
    expect(page.locator("html")).to_have_attribute("data-motion", "reduced")
    page.locator("#fontScalePreference").select_option("110")
    expect(page.locator("html")).to_have_attribute("style", re.compile(r"--font-scale:\s*110%"))
    expect(page.locator("#settingsSync")).to_have_text("Saved")

    skills = page.get_by_role("switch", name=re.compile(r"Skills panel"))
    scripts = page.get_by_role("switch", name=re.compile(r"Scripts panel"))
    expect(skills).to_be_checked()
    expect(page.locator("#skillsTab")).to_be_visible()
    expect(page.locator("#scriptsTab")).to_be_hidden()

    skills.uncheck()
    expect(page.locator("#skillsTab")).to_be_hidden()
    skills.check()
    expect(page.locator("#skillsTab")).to_be_visible()

    if scripts_supported:
        expect(scripts).to_be_visible()
        expect(scripts).not_to_be_checked()
        scripts.check()
        expect(scripts).to_be_checked()
        expect(page.locator("#scriptsTab")).to_be_visible()
    else:
        expect(page.locator("#scriptsPanelField")).to_be_hidden()

    launch = page.get_by_role("switch", name=re.compile(r"Launch on startup"))
    expect(launch).not_to_be_checked()
    expect(page.locator("#launchOnStartupStatus")).to_have_text("Disabled")

    launch.check()
    expect(launch).to_be_checked()
    expect(page.locator("#launchOnStartupStatus")).to_have_text("Enabled")
    assert page.evaluate("window.__launchOnStartup") is True

    launch.uncheck()
    expect(launch).not_to_be_checked()
    expect(page.locator("#launchOnStartupStatus")).to_have_text("Disabled")
    assert page.evaluate("window.__launchOnStartup") is False

    release_notes = page.get_by_role("button", name="Release notes")
    expect(release_notes).to_be_visible()
    release_notes.click()
    assert page.evaluate("window.__releaseNotesOpened") is True
    expect(popover).to_be_hidden()
    settings.click()
    expect(popover).to_be_visible()

    page.set_viewport_size({"width": 900, "height": 620})
    popover_box = popover.bounding_box()
    assert popover_box is not None
    assert popover_box["x"] >= 0 and popover_box["y"] >= 0
    assert popover_box["x"] + popover_box["width"] <= 900
    assert popover_box["y"] + popover_box["height"] <= 620

    page.keyboard.press("Escape")
    expect(popover).to_be_hidden()
    page.set_viewport_size({"width": 1440, "height": 900})


def assert_palette_and_theme(page) -> None:
    page.keyboard.press("Control+K")
    palette = page.locator("#commandPalette")
    expect(palette).to_be_visible()
    results = palette.locator(".command-result")
    expect(results.filter(has_text="STOP").filter(has_text="Live Fixture")).to_have_count(1)
    expect(results.filter(has_text="START").filter(has_text="Live Fixture")).to_have_count(0)
    expect(results.filter(has_text="START").filter(has_text="Dormant Fixture")).to_have_count(1)
    expect(results.filter(has_text="STOP").filter(has_text="Dormant Fixture")).to_have_count(0)

    page.locator("#commandInput").fill("ultraviolet")
    ultraviolet = results.filter(has_text="THEME").filter(has_text="ultraviolet")
    expect(ultraviolet).to_have_count(1)
    ultraviolet.click()
    expect(page.locator("html")).to_have_attribute("data-theme", "ultraviolet")
    page.reload(wait_until="networkidle")
    expect(page.locator("html")).to_have_attribute("data-theme", "ultraviolet")


def capture_theme_previews(page) -> None:
    OUTPUT_DIRECTORY.mkdir(exist_ok=True)
    page.locator(".compact-path").evaluate_all(
        """paths => paths.forEach((path, index) => {
            path.textContent = index ? 'C:\\\\Dev\\\\sample-api' : 'C:\\\\Dev\\\\sample-web';
            path.title = path.textContent;
        })"""
    )
    for theme in ["ultraviolet", "volt"]:
        page.locator("html").evaluate("(root, value) => { root.dataset.theme = value; }", theme)
        for width, height in [(1440, 900), (900, 620)]:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(150)
            page.screenshot(
                path=str(OUTPUT_DIRECTORY / f"theme-{theme}-{width}x{height}.png"),
                full_page=False,
            )
            has_overflow = page.evaluate(
                "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
            )
            assert not has_overflow, f"{theme} has horizontal overflow at {width}x{height}."
    page.set_viewport_size({"width": 1440, "height": 900})


def assert_responsive_layout(page) -> None:
    page.set_viewport_size({"width": 900, "height": 620})
    page.wait_for_timeout(250)
    has_overflow = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
    )
    assert not has_overflow, "The minimum window viewport has horizontal overflow."


def run() -> None:
    data_directory = Path(tempfile.mkdtemp(prefix="hackers-lair-playwright-"))
    manager_port = free_port()
    identity_file = data_directory / "api-token"
    live_directory = data_directory / "live-fixture"
    dormant_directory = data_directory / "dormant-fixture"
    live_directory.mkdir()
    dormant_directory.mkdir()
    write_projects(data_directory, [])
    script_name = write_script_fixture(data_directory) if os.name == "nt" else None

    environment = {
        **os.environ,
        "PORT": str(manager_port),
        "PROJECT_MANAGER_DATA_DIR": str(data_directory),
        "AGENTS_HOME": str(data_directory / "agents-disabled"),
    }
    service = subprocess.Popen(
        ["node", str(ROOT / "server.js")],
        cwd=ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    identity: dict | None = None
    browser = None
    console_errors: list[str] = []
    try:
        identity = wait_for_identity(identity_file, service)
        origin = f"http://127.0.0.1:{identity['port']}/"
        with ListeningFixture() as live_listener, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.context.grant_permissions(
                ["clipboard-read", "clipboard-write"],
                origin=origin.rstrip("/"),
            )
            page.on(
                "console",
                lambda message: console_errors.append(message.text)
                if message.type == "error"
                else None,
            )
            page.on("pageerror", lambda error: console_errors.append(str(error)))
            page.add_init_script(
                """
                localStorage.setItem('hackersLair.cinematicSeen', '1');
                window.__availableUpdate = {
                  channel: 'powershell',
                  channelLabel: 'PowerShell portable',
                  currentVersion: '2.1.0-beta.2',
                  mode: 'manual',
                  status: 'available',
                  version: '2.1.0-beta.3',
                  message: 'v2.1.0-beta.3 is available. Update when convenient with the PowerShell portable install command.',
                  upgradeCommand: 'irm https://hackerslairhq.github.io/desktop/install.ps1 | iex',
                  releaseUrl: 'https://github.com/hackerslairhq/desktop/releases/tag/v2.1.0-beta.3',
                  releaseNotes: '### Fixed\\n\\n- Portable update fixture notes.',
                  managedTargets: [],
                };
                window.hackerLairWindow = {
                  minimize: () => {},
                  toggleMaximize: () => {},
                  close: () => {},
                  restart: () => {},
                  shutdown: () => {},
                  onMaximizeChange: () => () => {},
                  getLaunchAtLogin: async () => ({
                    supported: true,
                    enabled: Boolean(window.__launchOnStartup),
                  }),
                  setLaunchAtLogin: async (enabled) => {
                    window.__launchOnStartup = Boolean(enabled);
                    return { supported: true, enabled: window.__launchOnStartup };
                  },
                  getUpdateState: async () => ({
                    channel: 'powershell',
                    channelLabel: 'PowerShell portable',
                    currentVersion: '2.1.0-beta.2',
                    mode: 'manual',
                    status: 'manual',
                    version: '',
                    message: 'Updates use the PowerShell portable install channel.',
                    upgradeCommand: 'irm https://hackerslairhq.github.io/desktop/install.ps1 | iex',
                    releaseUrl: 'https://github.com/hackerslairhq/desktop/releases',
                    releaseNotes: '### Fixed\\n\\n- Current release fixture notes.',
                    managedTargets: [],
                  }),
                  onUpdateState: (callback) => {
                    window.__lairUpdateListener = callback;
                    return () => {};
                  },
                  openUpdateNotes: async () => {
                    window.__releaseNotesOpened = true;
                    return true;
                  },
                };
                """
            )
            page.goto(origin, wait_until="networkidle")
            assert_empty_state(page)
            assert_project_editor_controls(page, data_directory / "chosen-folder")
            assert_project_port_conflict(
                page,
                live_directory,
                live_listener.port,
                console_errors,
            )

            dormant_port = free_port()
            write_projects(
                data_directory,
                [
                    project_fixture(
                        name="Live Fixture",
                        directory=live_directory,
                        port=live_listener.port,
                        component_name="live-web",
                    ),
                    project_fixture(
                        name="Dormant Fixture",
                        directory=dormant_directory,
                        port=dormant_port,
                        component_name="dormant-web",
                    ),
                ],
            )
            assert_target_states(page, live_listener.port, dormant_port)
            assert_port_signal_action_tray(page, live_listener.port)
            assert_minimal_update_controls(page)
            assert_settings_panel(page, scripts_supported=script_name is not None)
            if script_name:
                assert_script_action_tray(page, script_name)
            assert_palette_and_theme(page)
            capture_theme_previews(page)
            assert_responsive_layout(page)
            assert not console_errors, f"Browser console errors: {console_errors}"
            browser.close()
            browser = None
        print(
            "Playwright UI smoke passed: empty state, port conflict warning, target states, "
            "compact action trays, panel/startup settings, minimal update controls, "
            "palette, theme, and 900x620."
        )
    except Exception:
        OUTPUT_DIRECTORY.mkdir(exist_ok=True)
        try:
            if browser is not None:
                pages = browser.contexts[0].pages if browser.contexts else []
                if pages:
                    pages[0].screenshot(
                        path=str(OUTPUT_DIRECTORY / "playwright-ui-failure.png"),
                        full_page=True,
                    )
        except PlaywrightError:
            pass
        raise
    finally:
        if browser is not None:
            try:
                browser.close()
            except PlaywrightError:
                pass
        if identity is not None and service.poll() is None:
            try:
                shutdown_service(identity)
                service.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                service.kill()
        elif service.poll() is None:
            service.kill()
        shutil.rmtree(data_directory, ignore_errors=True)


if __name__ == "__main__":
    run()
