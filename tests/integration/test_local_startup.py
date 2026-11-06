from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path

import httpx


def test_python_api_starts_with_temporary_database(tmp_path: Path) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        ["uv", "run", "uvicorn", "harness_lab.main:build_app", "--factory", "--host", "127.0.0.1", "--port", str(port)],
        env={**os.environ, "DATABASE_PATH": str(tmp_path / "startup.sqlite")},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        for _ in range(100):
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout is not None else ""
                raise AssertionError(f"API exited before startup:\n{output}")
            try:
                response = httpx.get(f"http://127.0.0.1:{port}/api/v1/health", timeout=0.2)
                if response.status_code == 200:
                    assert response.json() == {"status": "ok"}
                    assert (tmp_path / "startup.sqlite").is_file()
                    return
            except httpx.HTTPError:
                time.sleep(0.05)
        raise AssertionError("API did not become ready")
    finally:
        process.terminate()
        process.wait(timeout=10)