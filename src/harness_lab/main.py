from __future__ import annotations

import os

import uvicorn

from .api import create_app
from .api.app import create_default_services


def build_app() -> object:
    database_path = os.environ.get("DATABASE_PATH", "data/harness.sqlite")
    return create_app(create_default_services(database_path))


def main() -> None:
    uvicorn.run(
        "harness_lab.main:build_app",
        factory=True,
        host=os.environ.get("APP_HOST", "127.0.0.1"),
        port=int(os.environ.get("APP_PORT", "8000")),
    )


if __name__ == "__main__":
    main()