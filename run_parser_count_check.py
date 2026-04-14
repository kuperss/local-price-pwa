from __future__ import annotations

import argparse
import base64
import contextlib
import os
import sys
import threading
import time
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.support.ui import WebDriverWait


PAGE_FILE = "parser_driver.html"
DEFAULT_TIMEOUT_SECONDS = 300


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run local-price-pwa against a PDF folder and report parsed entry counts per file.",
    )
    parser.add_argument(
        "--pwa-dir",
        required=True,
        help="Path to the local-price-pwa folder.",
    )
    parser.add_argument(
        "--pdf-dir",
        required=True,
        help="Path to the folder containing PDFs to test.",
    )
    parser.add_argument(
        "--browser",
        choices=["auto", "edge", "chrome"],
        default="auto",
        help="Browser to use for the headless run.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Maximum seconds to wait for the browser page.",
    )
    parser.add_argument(
        "--report-dir",
        default=".",
        help="Folder where the text report should be saved.",
    )
    parser.add_argument(
        "--expect",
        type=int,
        help="Optional expected entry count per file.",
    )
    return parser.parse_args()


def resolve_path(raw_path: str) -> Path:
    return Path(raw_path).expanduser().resolve()


def ensure_paths(pwa_dir: Path, pdf_dir: Path, report_dir: Path) -> None:
    if not pwa_dir.is_dir():
        raise SystemExit(f"PWA folder not found: {pwa_dir}")
    if not pdf_dir.is_dir():
        raise SystemExit(f"PDF folder not found: {pdf_dir}")
    if not (pwa_dir / PAGE_FILE).is_file():
        raise SystemExit(f"Driver page not found: {pwa_dir / PAGE_FILE}")
    report_dir.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def copyfile(self, source, outputfile) -> None:
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return


@contextlib.contextmanager
def run_server(root_dir: Path):
    handler = partial(QuietHandler, directory=str(root_dir))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def build_driver_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/{PAGE_FILE}?_={int(time.time())}"


def build_driver(browser: str):
    last_error: Exception | None = None

    if browser in {"auto", "edge"}:
        try:
            options = EdgeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--window-size=1440,1200")
            return webdriver.Edge(options=options), "Edge"
        except Exception as error:  # pragma: no cover - browser availability differs by machine
            last_error = error
            if browser == "edge":
                raise

    if browser in {"auto", "chrome"}:
        try:
            options = ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--window-size=1440,1200")
            return webdriver.Chrome(options=options), "Chrome"
        except Exception as error:  # pragma: no cover - browser availability differs by machine
            last_error = error
            if browser == "chrome":
                raise

    raise RuntimeError(f"Unable to start a supported browser: {last_error}")


def get_page_output(driver) -> str:
    return driver.execute_script(
        "return document.getElementById('output')?.textContent || '';",
    )


def wait_for_ready(driver, timeout_seconds: int) -> None:
    wait = WebDriverWait(driver, timeout_seconds)
    wait.until(lambda current_driver: "done=1" in get_page_output(current_driver))
    output = get_page_output(driver)
    if "FAILED" in output or "ready=1" not in output:
        raise RuntimeError(output.strip() or "Driver page did not become ready.")


def parse_pdf_in_browser(driver, file_name: str, pdf_bytes: bytes) -> dict[str, object]:
    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    script = """
const fileName = arguments[0];
const base64Data = arguments[1];
const callback = arguments[arguments.length - 1];

(async () => {
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const result = await window.__localPricePwaTestHooks.parsePdfBuffer(fileName, bytes.buffer);
    callback({ ok: true, result });
  } catch (error) {
    callback({
      ok: false,
      name: error?.name || "Error",
      message: error?.message || String(error),
      details: error?.details || "",
      stack: error?.stack || "",
    });
  }
})();
"""
    response = driver.execute_async_script(script, file_name, encoded)
    if response.get("ok"):
        return response["result"]

    details = response.get("details")
    error_message = f"{response.get('name', 'Error')}: {response.get('message', 'Unknown error')}"
    if details:
        error_message = f"{error_message} ({details})"
    if response.get("stack"):
        error_message = f"{error_message}\n{response['stack']}"
    raise RuntimeError(error_message)


def iter_pdf_files(pdf_dir: Path) -> list[Path]:
    return sorted(
        (path for path in pdf_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pdf"),
        key=lambda path: path.name.casefold(),
    )


def save_report(report_dir: Path, report_text: str) -> tuple[Path, Path]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    latest_path = report_dir / "parser_count_report_latest.txt"
    archive_path = report_dir / f"parser_count_report_{timestamp}.txt"
    latest_path.write_text(report_text, encoding="utf-8")
    archive_path.write_text(report_text, encoding="utf-8")
    return latest_path, archive_path


def build_report_text(
    pwa_dir: Path,
    pdf_dir: Path,
    browser_name: str,
    files: list[Path],
    results: list[dict[str, object]],
    errors: list[dict[str, object]],
    expect: int | None,
) -> str:
    lines = [
        f"pwa_dir={pwa_dir}",
        f"pdf_dir={pdf_dir}",
        f"browser={browser_name}",
        "",
        f"files={len(files)}",
        "",
        "count\tpages\tbytes\tfileName",
    ]

    total_entries = 0
    for item in results:
        total_entries += int(item["entryCount"])
        lines.append(
            f"{item['entryCount']}\t{item['pageCount']}\t{item['bytes']}\t{item['fileName']}",
        )

    for item in errors:
        lines.append(f"ERROR\t-\t{item['bytes']}\t{item['fileName']}")
        lines.append(f"  {item['error']}")

    lines.extend(
        [
            "",
            f"totalEntries={total_entries}",
            f"errors={len(errors)}",
        ],
    )

    if expect is not None:
        mismatches = [item for item in results if int(item["entryCount"]) != expect]
        lines.append(f"expect={expect}")
        lines.append(f"mismatches={len(mismatches)}")
        for item in mismatches:
            lines.append(f"MISMATCH\t{item['entryCount']}\t{item['fileName']}")

    lines.append("done=1")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    pwa_dir = resolve_path(args.pwa_dir)
    pdf_dir = resolve_path(args.pdf_dir)
    report_dir = resolve_path(args.report_dir)
    ensure_paths(pwa_dir, pdf_dir, report_dir)

    files = iter_pdf_files(pdf_dir)
    results: list[dict[str, object]] = []
    errors: list[dict[str, object]] = []

    with run_server(pwa_dir) as port:
        driver_url = build_driver_url(port)
        driver, browser_name = build_driver(args.browser)
        try:
            driver.get(driver_url)
            wait_for_ready(driver, args.timeout)

            for pdf_path in files:
                pdf_bytes = pdf_path.read_bytes()
                if not pdf_bytes:
                    errors.append(
                        {
                            "fileName": pdf_path.name,
                            "bytes": 0,
                            "error": "Local file is empty.",
                        },
                    )
                    continue

                try:
                    parsed = parse_pdf_in_browser(driver, pdf_path.name, pdf_bytes)
                    results.append(
                        {
                            "fileName": pdf_path.name,
                            "bytes": len(pdf_bytes),
                            "entryCount": int(parsed.get("entryCount", 0)),
                            "pageCount": int(parsed.get("pageCount", 0)),
                            "profileId": str(parsed.get("profileId", "")),
                        },
                    )
                except Exception as error:  # pragma: no cover - browser-side errors vary by file
                    errors.append(
                        {
                            "fileName": pdf_path.name,
                            "bytes": len(pdf_bytes),
                            "error": str(error),
                        },
                    )
        finally:
            driver.quit()

    report_text = build_report_text(
        pwa_dir=pwa_dir,
        pdf_dir=pdf_dir,
        browser_name=browser_name,
        files=files,
        results=results,
        errors=errors,
        expect=args.expect,
    )
    latest_path, archive_path = save_report(report_dir, report_text)

    print(f"[INFO] Report saved: {latest_path}")
    print(f"[INFO] Archived copy: {archive_path}")
    print()
    print(report_text)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
