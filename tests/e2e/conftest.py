from __future__ import annotations

import os
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Browser, Playwright, sync_playwright


@pytest.fixture(scope="session")
def live_server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    database_path = tmp_path_factory.mktemp("e2e") / "harness.sqlite"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "DATABASE_PATH": str(database_path)}
    process = subprocess.Popen(
        ["uv", "run", "uvicorn", "harness_lab.main:build_app", "--factory", "--host", "127.0.0.1", "--port", str(port)],
        cwd=Path(__file__).parents[2],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout is not None else ""
                pytest.fail(f"Uvicorn exited before startup:\n{output}")
            try:
                if httpx.get(f"{base_url}/api/v1/health", timeout=0.2).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.05)
        else:
            pytest.fail("Uvicorn did not become ready")
        yield base_url
    finally:
        process.terminate()
        process.wait(timeout=10)


@pytest.fixture
def browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        browser = _launch_browser(playwright)
        try:
            yield browser
        finally:
            browser.close()


def _launch_browser(playwright: Playwright) -> Browser:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or _discover_cached_chromium()
    return playwright.chromium.launch(headless=True, executable_path=executable)


def _discover_cached_chromium() -> str | None:
    cache_root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / ".cache" / "ms-playwright")
    if not cache_root.is_dir():
        return None
    candidates = sorted(
        (
            *cache_root.glob("chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"),
            *cache_root.glob("chromium-*/chrome-linux*/chrome"),
        ),
        reverse=True,
    )
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None