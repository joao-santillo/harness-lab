from __future__ import annotations

import argparse
import os

from .worker.main import start_worker


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="harness-lab")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("worker", help="start the durable round worker")
    subparsers.add_parser("api", help="start the FastAPI server")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "api":
        from .main import main as api_main

        api_main()
        return 0
    started = __import__("asyncio").run(start_worker(dict(os.environ)))
    return 0 if started else 0


if __name__ == "__main__":
    raise SystemExit(main())