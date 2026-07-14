#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse


BASE_DIR = Path(__file__).resolve().parent
SCRIPT = BASE_DIR / "scripts" / "wikijs.py"
DEFAULT_TIMEOUT_SECONDS = int(os.environ.get("MCP_SCRIPT_TIMEOUT_SECONDS", "90"))

mcp = FastMCP(
    "wikijs",
    host=os.environ.get("MCP_HOST", "0.0.0.0"),
    port=int(os.environ.get("MCP_PORT", "8000")),
)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


def run_helper(args: list[str], timeout_seconds: int | None = None) -> Any:
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        return {"ok": False, "error": "args must be a list of strings"}

    timeout = timeout_seconds or DEFAULT_TIMEOUT_SECONDS
    try:
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=str(BASE_DIR),
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        return {
            "ok": False,
            "args": args,
            "error": f"Timed out after {timeout} seconds",
            "stdout": error.stdout,
            "stderr": error.stderr,
        }

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    if completed.returncode != 0:
        return {
            "ok": False,
            "args": args,
            "returncode": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }

    if not stdout:
        return {"ok": True}

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"ok": True, "stdout": stdout, "stderr": stderr}


def add_optional(args: list[str], flag: str, value: Any) -> None:
    if value is not None:
        args.extend([flag, str(value)])


@mcp.tool()
def wikijs_search_pages(
    query: str,
    locale: str = "en",
    limit: int = 10,
    path_prefix: str | None = None,
    order_by: str | None = None,
    timeout_seconds: int | None = None,
) -> Any:
    """Search Wiki.js pages by text and return ranked results with snippets.

    order_by choices: updatedAt, createdAt.
    """
    args = ["search-pages", "--query", query, "--locale", locale, "--limit", str(limit)]
    add_optional(args, "--path-prefix", path_prefix)
    add_optional(args, "--order-by", order_by)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_get_page(
    path: str | None = None,
    id: int | None = None,
    locale: str = "en",
    timeout_seconds: int | None = None,
) -> Any:
    """Get one Wiki.js page by path or ID."""
    args = ["get-page", "--locale", locale]
    add_optional(args, "--path", path)
    add_optional(args, "--id", id)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_bulk_get_pages(
    ids: list[int] | None = None,
    paths: list[str] | None = None,
    locale: str = "en",
    continue_on_error: bool = True,
    timeout_seconds: int | None = None,
) -> Any:
    """Get multiple Wiki.js pages by ID and/or path in one call."""
    args = [
        "bulk-get-pages",
        "--ids", json.dumps(ids or []),
        "--paths", json.dumps(paths or []),
        "--locale", locale,
    ]
    if not continue_on_error:
        args.append("--no-continue-on-error")
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_search_and_get_page(
    query: str,
    locale: str = "en",
    timeout_seconds: int | None = None,
) -> Any:
    """Search Wiki.js pages and return the full page for one strong match, otherwise ranked snippets."""
    return run_helper(["search-and-get-page", "--query", query, "--locale", locale], timeout_seconds)


@mcp.tool()
def wikijs_get_page_by_title(
    title: str,
    locale: str = "en",
    timeout_seconds: int | None = None,
) -> Any:
    """Get one Wiki.js page by title."""
    return run_helper(["get-page-by-title", "--title", title, "--locale", locale], timeout_seconds)


@mcp.tool()
def wikijs_list_pages(
    locale: str = "en",
    path_prefix: str | None = None,
    limit: int = 50,
    order_by: str | None = None,
    timeout_seconds: int | None = None,
) -> Any:
    """List Wiki.js pages.

    order_by choices: updatedAt, createdAt.
    """
    args = ["list-pages", "--locale", locale, "--limit", str(limit)]
    add_optional(args, "--path-prefix", path_prefix)
    add_optional(args, "--order-by", order_by)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_create_page(
    path: str,
    title: str,
    content: str,
    description: str = "",
    locale: str = "en",
    tags: list[str] | None = None,
    is_published: bool = True,
    is_private: bool = False,
    editor: str = "markdown",
    timeout_seconds: int | None = None,
) -> Any:
    """Create a Wiki.js page."""
    args = [
        "create-page",
        "--path", path,
        "--title", title,
        "--content", content,
        "--description", description,
        "--locale", locale,
        "--tags", json.dumps(tags or []),
        "--editor", editor,
        "--is-published" if is_published else "--no-is-published",
        "--is-private" if is_private else "--no-is-private",
    ]
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_bulk_create_pages(
    pages: list[dict[str, Any]],
    continue_on_error: bool = True,
    timeout_seconds: int | None = None,
) -> Any:
    """Create multiple Wiki.js pages in one call.

    Each dict in `pages` accepts the same keys as wikijs_create_page's
    arguments: path, title, and content are required; description, locale,
    tags, isPublished, isPrivate, and editor are optional.
    """
    args = ["bulk-create-pages", "--pages", json.dumps(pages)]
    if not continue_on_error:
        args.append("--no-continue-on-error")
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_update_page(
    path: str | None = None,
    id: int | None = None,
    title: str | None = None,
    content: str | None = None,
    description: str | None = None,
    locale: str | None = None,
    tags: list[str] | None = None,
    is_published: bool | None = None,
    is_private: bool | None = None,
    editor: str | None = None,
    timeout_seconds: int | None = None,
) -> Any:
    """Update a Wiki.js page by path or ID. Omitted fields keep their existing values."""
    args = ["update-page"]
    add_optional(args, "--path", path)
    add_optional(args, "--id", id)
    add_optional(args, "--title", title)
    add_optional(args, "--content", content)
    add_optional(args, "--description", description)
    add_optional(args, "--locale", locale)
    if tags is not None:
        args.extend(["--tags", json.dumps(tags)])
    if is_published is True:
        args.append("--is-published")
    elif is_published is False:
        args.append("--no-is-published")
    if is_private is True:
        args.append("--is-private")
    elif is_private is False:
        args.append("--no-is-private")
    add_optional(args, "--editor", editor)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_bulk_update_pages(
    updates: list[dict[str, Any]],
    continue_on_error: bool = True,
    timeout_seconds: int | None = None,
) -> Any:
    """Update multiple Wiki.js pages in one call. Omitted fields keep their existing values.

    Each dict in `updates` needs path or id, plus any fields to change:
    title, content, description, locale, tags, isPublished, isPrivate, editor.
    """
    args = ["bulk-update-pages", "--updates", json.dumps(updates)]
    if not continue_on_error:
        args.append("--no-continue-on-error")
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_replace_regex(
    page_id: int,
    pattern: str,
    replacement: str,
    flags: str = "g",
    locale: str = "en",
    timeout_seconds: int | None = None,
) -> Any:
    """Replace text in a Wiki.js page using a Python regular expression.

    Supported flags: g (replace all matches, not just the first), i
    (case-insensitive), m (multiline), s (dot matches newline). This server
    uses Python's `re` engine, not JavaScript's, so flags d/u/v/y are not
    supported and some regex syntax may differ subtly from JS.
    """
    args = [
        "replace-regex",
        "--page-id", str(page_id),
        "--pattern", pattern,
        "--replacement", replacement,
        "--flags", flags,
        "--locale", locale,
    ]
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_delete_page(
    path: str | None = None,
    id: int | None = None,
    locale: str = "en",
    timeout_seconds: int | None = None,
) -> Any:
    """Delete a Wiki.js page by path or ID."""
    args = ["delete-page", "--locale", locale]
    add_optional(args, "--path", path)
    add_optional(args, "--id", id)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_move_page(
    destination_path: str,
    path: str | None = None,
    id: int | None = None,
    locale: str = "en",
    destination_locale: str | None = None,
    timeout_seconds: int | None = None,
) -> Any:
    """Move (rename/relocate) a Wiki.js page by path or ID to a new path and/or locale."""
    args = ["move-page", "--destination-path", destination_path, "--locale", locale]
    add_optional(args, "--path", path)
    add_optional(args, "--id", id)
    add_optional(args, "--destination-locale", destination_locale)
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_bulk_move_pages(
    moves: list[dict[str, Any]],
    continue_on_error: bool = True,
    timeout_seconds: int | None = None,
) -> Any:
    """Move multiple Wiki.js pages in one call.

    Each dict in `moves` needs destinationPath, plus path or id to select
    the page, and optionally locale and destinationLocale.
    """
    args = ["bulk-move-pages", "--moves", json.dumps(moves)]
    if not continue_on_error:
        args.append("--no-continue-on-error")
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_bulk_delete_pages(
    ids: list[int] | None = None,
    paths: list[str] | None = None,
    locale: str = "en",
    continue_on_error: bool = True,
    timeout_seconds: int | None = None,
) -> Any:
    """Delete multiple Wiki.js pages by ID and/or path in one call."""
    args = [
        "bulk-delete-pages",
        "--ids", json.dumps(ids or []),
        "--paths", json.dumps(paths or []),
        "--locale", locale,
    ]
    if not continue_on_error:
        args.append("--no-continue-on-error")
    return run_helper(args, timeout_seconds)


@mcp.tool()
def wikijs_graphql(
    query: str,
    variables: dict[str, Any] | None = None,
    timeout_seconds: int | None = None,
) -> Any:
    """Run an authenticated Wiki.js GraphQL query or mutation."""
    args = ["graphql", "--query", query, "--variables", json.dumps(variables or {})]
    return run_helper(args, timeout_seconds)


if __name__ == "__main__":
    mcp.run(transport=os.environ.get("MCP_TRANSPORT", "streamable-http"))
