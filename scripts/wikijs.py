#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / "wikijs.env"
SUPPORTED_REGEX_FLAGS = set("gims")


class WikiError(Exception):
    pass


def load_env():
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def graphql_request(query, variables=None):
    load_env()
    base_url = os.environ.get("WIKIJS_URL")
    if not base_url:
        raise SystemExit(f"Set WIKIJS_URL in {ENV_FILE}.")
    token = os.environ.get("WIKIJS_API_TOKEN")
    if not token:
        raise SystemExit(f"Set WIKIJS_API_TOKEN in {ENV_FILE}.")

    data = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "wikijs-mcp-helper/1.0",
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/graphql", data=data, method="POST", headers=headers
    )
    try:
        with urllib.request.urlopen(request) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        try:
            details = json.loads(body)
        except json.JSONDecodeError:
            details = body or error.reason
        print(json.dumps({"status": error.code, "error": details}, indent=2), file=sys.stderr)
        raise SystemExit(1) from error
    except urllib.error.URLError as error:
        print(json.dumps({"error": str(error.reason)}, indent=2), file=sys.stderr)
        raise SystemExit(1) from error

    try:
        parsed = json.loads(body) if body else {}
    except json.JSONDecodeError:
        parsed = {"raw": body}

    if parsed.get("errors"):
        raise WikiError(f"wikijs_graphql_failed: {json.dumps(parsed['errors'])}")

    return parsed.get("data") or {}


# --- GraphQL documents (kept identical in shape to the Wiki.js schema) ---

SEARCH_PAGES_QUERY = """
query SearchPages($query: String!, $locale: String!) {
  pages {
    search(query: $query, locale: $locale) {
      results {
        id
        title
        description
        path
        locale
      }
    }
  }
}
"""

GET_PAGE_BY_ID_QUERY = """
query GetPageById($id: Int!) {
  pages {
    single(id: $id) {
      id
      path
      locale
      title
      description
      content
      render
      editor
      isPublished
      isPrivate
      privateNS
      tags {
        tag
        title
      }
      createdAt
      updatedAt
    }
  }
}
"""

GET_PAGE_BY_PATH_QUERY = """
query GetPageByPath($path: String!, $locale: String!) {
  pages {
    singleByPath(path: $path, locale: $locale) {
      id
      path
      locale
      title
      description
      content
      render
      editor
      isPublished
      isPrivate
      privateNS
      tags {
        tag
        title
      }
      createdAt
      updatedAt
    }
  }
}
"""

LIST_PAGES_QUERY = """
query ListPages($locale: String, $limit: Int) {
  pages {
    list(locale: $locale, limit: $limit) {
      id
      path
      locale
      title
      description
      isPublished
      isPrivate
      privateNS
      tags
      createdAt
      updatedAt
    }
  }
}
"""

CREATE_PAGE_MUTATION = """
mutation CreatePage(
  $content: String!
  $description: String!
  $editor: String!
  $isPublished: Boolean!
  $isPrivate: Boolean!
  $locale: String!
  $path: String!
  $tags: [String]!
  $title: String!
) {
  pages {
    create(
      content: $content
      description: $description
      editor: $editor
      isPublished: $isPublished
      isPrivate: $isPrivate
      locale: $locale
      path: $path
      tags: $tags
      title: $title
    ) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
    }
  }
}
"""

UPDATE_PAGE_MUTATION = """
mutation UpdatePage(
  $id: Int!
  $content: String!
  $description: String!
  $editor: String!
  $isPublished: Boolean!
  $isPrivate: Boolean!
  $locale: String!
  $path: String!
  $tags: [String]!
  $title: String!
) {
  pages {
    update(
      id: $id
      content: $content
      description: $description
      editor: $editor
      isPublished: $isPublished
      isPrivate: $isPrivate
      locale: $locale
      path: $path
      tags: $tags
      title: $title
    ) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
    }
  }
}
"""

MOVE_PAGE_MUTATION = """
mutation MovePage($id: Int!, $destinationPath: String!, $destinationLocale: String!) {
  pages {
    move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
    }
  }
}
"""

DELETE_PAGE_MUTATION = """
mutation DeletePage($id: Int!) {
  pages {
    delete(id: $id) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
    }
  }
}
"""


# --- Normalization / ranking helpers ---

def normalize_tags(tags):
    if not isinstance(tags, list):
        return []
    result = []
    for tag in tags:
        if isinstance(tag, str):
            result.append(tag)
        elif isinstance(tag, dict):
            value = tag.get("tag") or tag.get("title")
            if value:
                result.append(value)
    return result


def normalize_page(page):
    if not page:
        return None
    return {
        "found": True,
        "id": page.get("id"),
        "title": page.get("title"),
        "path": page.get("path"),
        "content": page.get("content"),
        "description": page.get("description"),
        "locale": page.get("locale"),
        "tags": normalize_tags(page.get("tags")),
        "editor": page.get("editor"),
        "isPublished": page.get("isPublished"),
        "isPrivate": page.get("isPrivate"),
        "createdAt": page.get("createdAt"),
        "updatedAt": page.get("updatedAt"),
    }


def normalize_search_result(page):
    return {
        "id": page.get("id"),
        "title": page.get("title"),
        "path": page.get("path"),
        "description": page.get("description"),
        "locale": page.get("locale"),
    }


def normalize_page_list_item(page):
    return {
        "id": page.get("id"),
        "title": page.get("title"),
        "path": page.get("path"),
        "description": page.get("description"),
        "locale": page.get("locale"),
        "tags": normalize_tags(page.get("tags")),
        "isPublished": page.get("isPublished"),
        "isPrivate": page.get("isPrivate"),
        "createdAt": page.get("createdAt"),
        "updatedAt": page.get("updatedAt"),
    }


def snippet_from_text(text, query, radius=220):
    compact = re.sub(r"\s+", " ", text or "").strip()
    if not compact:
        return ""

    query_terms = [term for term in query.lower().split() if term]
    lower = compact.lower()
    positions = sorted(pos for pos in (lower.find(term) for term in query_terms) if pos >= 0)
    index = positions[0] if positions else 0
    start = max(0, index - radius)
    end = min(len(compact), index + radius)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(compact) else ""
    return f"{prefix}{compact[start:end]}{suffix}"


def snippet_for_page(page, query):
    text = "\n\n".join(filter(None, [page.get("title"), page.get("description"), page.get("content")]))
    return snippet_from_text(text, query)


def filter_by_path_prefix(pages, path_prefix):
    if not path_prefix:
        return pages
    normalized_prefix = path_prefix.strip("/")
    return [page for page in pages if str(page.get("path") or "").lstrip("/").startswith(normalized_prefix)]


def sort_pages(pages, order_by):
    if not order_by:
        return pages

    def sort_key(page):
        value = page.get(order_by)
        if not value:
            return 0.0
        try:
            from datetime import datetime

            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0

    return sorted(pages, key=sort_key, reverse=True)


def normalize_comparable(value):
    text = str(value or "").lower()
    text = re.sub(r"[-_/]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def similarity_score(query, value):
    if not value:
        return 0
    if value == query:
        return 100
    if query in value:
        return 90
    if value in query:
        return 80
    query_terms = set(query.split())
    value_terms = set(value.split())
    overlap = len(query_terms & value_terms)
    if overlap == 0 or not query_terms:
        return 0
    return round((overlap / len(query_terms)) * 70)


def rank_pages(query, pages, fields):
    normalized_query = normalize_comparable(query)
    if not normalized_query:
        return [{**page, "score": 0} for page in pages[:5]]

    ranked = []
    for page in pages:
        score = max(similarity_score(normalized_query, normalize_comparable(page.get(field))) for field in fields)
        if score > 0:
            ranked.append({**page, "score": score})
    ranked.sort(key=lambda page: page["score"], reverse=True)
    return ranked


def page_suggestion(page):
    return {
        "id": page.get("id"),
        "title": page.get("title"),
        "path": page.get("path"),
        "locale": page.get("locale"),
        "description": page.get("description"),
        "createdAt": page.get("createdAt"),
        "updatedAt": page.get("updatedAt"),
        "score": page.get("score"),
    }


def not_found_result(kind, searched, locale, suggestions):
    return {
        "found": False,
        "error": "page_not_found",
        "searched": {"kind": kind, **searched},
        "locale": locale,
        "suggestions": suggestions,
    }


def strong_search_match(query, results):
    if not results:
        return None
    if len(results) == 1:
        return results[0]

    normalized_query = normalize_comparable(query)
    for page in results:
        if (
            normalize_comparable(page.get("title")) == normalized_query
            or normalize_comparable(page.get("path")) == normalized_query
        ):
            return page
    return None


def tags_input(tags):
    if tags is None:
        return []
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise WikiError("tags must be an array of strings.")
    return tags


# --- Domain operations ---

def fetch_page_list(locale, limit):
    data = graphql_request(LIST_PAGES_QUERY, {"locale": locale, "limit": limit})
    return (data.get("pages") or {}).get("list") or []


def closest_page_suggestions(id=None, path=None, title=None, locale="en"):
    query = path or title or (str(id) if id is not None else "")
    pages = [normalize_page_list_item(page) for page in fetch_page_list(locale, 500)]
    return [page_suggestion(page) for page in rank_pages(query, pages, ["title", "path"])[:5]]


def get_page(id=None, path=None, locale="en"):
    if id is None and path is None:
        raise WikiError("Provide either id or path.")

    searched = {"id": id} if id is not None else {"path": path}
    if id is not None:
        data = graphql_request(GET_PAGE_BY_ID_QUERY, {"id": id})
        raw = (data.get("pages") or {}).get("single")
    else:
        data = graphql_request(GET_PAGE_BY_PATH_QUERY, {"path": path, "locale": locale})
        raw = (data.get("pages") or {}).get("singleByPath")

    page = normalize_page(raw)
    if page:
        return page
    return not_found_result("page", searched, locale, closest_page_suggestions(locale=locale, **searched))


def resolve_page(id=None, path=None, locale="en"):
    page = get_page(id=id, path=path, locale=locale)
    if not page.get("found"):
        raise WikiError(f"Page not found: {json.dumps(page)}")
    return page


def pages_with_snippets(results, query, locale):
    pages = []
    for result in results:
        page = get_page(id=result.get("id"), locale=locale)
        if page.get("found"):
            pages.append(
                {
                    "id": page["id"],
                    "title": page["title"],
                    "path": page["path"],
                    "description": page["description"],
                    "locale": page["locale"],
                    "snippet": snippet_for_page(page, query),
                    "createdAt": page["createdAt"],
                    "updatedAt": page["updatedAt"],
                }
            )
        else:
            text = "\n".join(filter(None, [result.get("title"), result.get("description"), result.get("path")]))
            pages.append({**result, "snippet": snippet_from_text(text, query)})
    return pages


def search_pages(query, locale="en", limit=10, path_prefix=None, order_by=None):
    data = graphql_request(SEARCH_PAGES_QUERY, {"query": query, "locale": locale})
    results = [normalize_search_result(page) for page in ((data.get("pages") or {}).get("search") or {}).get("results", [])]
    results = filter_by_path_prefix(results, path_prefix)
    if not order_by:
        results = results[:limit]

    pages = pages_with_snippets(results, query, locale)
    pages = sort_pages(pages, order_by)[:limit]
    return {
        "query": query,
        "locale": locale,
        "pathPrefix": path_prefix,
        "orderBy": order_by,
        "count": len(pages),
        "results": pages,
    }


def bulk_get_pages(ids=None, paths=None, locale="en", continue_on_error=True):
    selectors = [{"id": i, "locale": locale} for i in (ids or [])] + [
        {"path": p, "locale": locale} for p in (paths or [])
    ]
    if not selectors:
        raise WikiError("Provide at least one id or path in ids/paths.")

    results = []
    for selector in selectors:
        try:
            page = get_page(id=selector.get("id"), path=selector.get("path"), locale=selector["locale"])
            results.append({"selector": selector, "succeeded": True, "page": page})
        except Exception as error:
            results.append({"selector": selector, "succeeded": False, "error": str(error)})
            if not continue_on_error:
                break

    return {
        "locale": locale,
        "attempted": len(selectors),
        "succeeded": sum(1 for r in results if r["succeeded"]),
        "failed": sum(1 for r in results if not r["succeeded"]),
        "results": results,
    }


def search_and_get_page(query, locale="en"):
    search = search_pages(query=query, locale=locale, limit=8)
    strong = strong_search_match(query, search["results"])
    if not strong:
        return {
            "query": query,
            "locale": locale,
            "match": "multiple",
            "count": search["count"],
            "results": search["results"],
        }
    return {"query": query, "locale": locale, "match": "single", "page": get_page(id=strong["id"], locale=locale)}


def get_page_by_title(title, locale="en"):
    pages = [normalize_page_list_item(page) for page in fetch_page_list(locale, 500)]
    ranked = rank_pages(title, pages, ["title", "path"])
    exact = next((page for page in ranked if normalize_comparable(page.get("title")) == normalize_comparable(title)), None)

    if exact:
        return get_page(id=exact["id"], locale=locale)

    if ranked and (len(ranked) == 1 or (ranked[0]["score"] >= 90 and ranked[0]["score"] - (ranked[1]["score"] if len(ranked) > 1 else 0) >= 25)):
        return get_page(id=ranked[0]["id"], locale=locale)

    return not_found_result("title", {"title": title}, locale, [page_suggestion(page) for page in ranked[:5]])


def list_pages(locale="en", path_prefix=None, limit=50, order_by=None):
    fetch_limit = max(limit, 1000) if path_prefix else max(limit, 250)
    pages = [normalize_page_list_item(page) for page in fetch_page_list(locale, fetch_limit)]
    pages = filter_by_path_prefix(pages, path_prefix)
    pages = sort_pages(pages, order_by)
    pages = pages[:limit]
    return {"locale": locale, "pathPrefix": path_prefix, "orderBy": order_by, "count": len(pages), "results": pages}


def create_page(path, title, content, description="", locale="en", tags=None, is_published=True, is_private=False, editor="markdown"):
    if not path or not str(path).strip():
        raise WikiError("path must be a non-empty string.")
    if not title or not str(title).strip():
        raise WikiError("title must be a non-empty string.")
    if not content or not str(content).strip():
        raise WikiError("content must be a non-empty string.")

    variables = {
        "path": path,
        "title": title,
        "content": content,
        "description": description or "",
        "locale": locale or "en",
        "tags": tags_input(tags),
        "isPublished": bool(is_published),
        "isPrivate": bool(is_private),
        "editor": editor or "markdown",
    }
    return graphql_request(CREATE_PAGE_MUTATION, variables)


def bulk_create_pages(pages, continue_on_error=True):
    if not pages:
        raise WikiError("Provide at least one page in pages.")

    results = []
    for page in pages:
        selector = {"path": page.get("path"), "locale": page.get("locale") or "en"}
        try:
            response = create_page(
                path=page.get("path"),
                title=page.get("title"),
                content=page.get("content"),
                description=page.get("description") or "",
                locale=page.get("locale") or "en",
                tags=page.get("tags"),
                is_published=page.get("isPublished", True),
                is_private=page.get("isPrivate", False),
                editor=page.get("editor") or "markdown",
            )
            results.append({"page": selector, "succeeded": True, "response": response})
        except Exception as error:
            results.append({"page": selector, "succeeded": False, "error": str(error)})
            if not continue_on_error:
                break

    return {
        "attempted": len(pages),
        "succeeded": sum(1 for r in results if r["succeeded"]),
        "failed": sum(1 for r in results if not r["succeeded"]),
        "results": results,
    }


def update_page(id=None, path=None, title=None, content=None, description=None, locale=None, tags=None, is_published=None, is_private=None, editor=None):
    existing = resolve_page(id=id, path=path, locale=locale or "en")
    variables = {
        "id": existing["id"],
        "path": path if path is not None else existing["path"],
        "title": title if title is not None else existing["title"],
        "content": content if content is not None else (existing.get("content") or ""),
        "description": description if description is not None else (existing.get("description") or ""),
        "locale": locale if locale is not None else (existing.get("locale") or "en"),
        "tags": tags_input(tags) if tags is not None else (existing.get("tags") or []),
        "isPublished": is_published if is_published is not None else bool(existing.get("isPublished", True)),
        "isPrivate": is_private if is_private is not None else bool(existing.get("isPrivate", False)),
        "editor": editor or existing.get("editor") or "markdown",
    }
    return graphql_request(UPDATE_PAGE_MUTATION, variables)


def bulk_update_pages(updates, continue_on_error=True):
    if not updates:
        raise WikiError("Provide at least one update in updates.")

    results = []
    for update in updates:
        selector = {"path": update.get("path"), "id": update.get("id"), "locale": update.get("locale") or "en"}
        try:
            response = update_page(
                id=update.get("id"),
                path=update.get("path"),
                title=update.get("title"),
                content=update.get("content"),
                description=update.get("description"),
                locale=update.get("locale"),
                tags=update.get("tags"),
                is_published=update.get("isPublished"),
                is_private=update.get("isPrivate"),
                editor=update.get("editor"),
            )
            results.append({"update": selector, "succeeded": True, "response": response})
        except Exception as error:
            results.append({"update": selector, "succeeded": False, "error": str(error)})
            if not continue_on_error:
                break

    return {
        "attempted": len(updates),
        "succeeded": sum(1 for r in results if r["succeeded"]),
        "failed": sum(1 for r in results if not r["succeeded"]),
        "results": results,
    }


def validate_regex_flags(flags):
    if not flags:
        return
    if not set(flags) <= SUPPORTED_REGEX_FLAGS:
        raise WikiError(
            "flags must contain only supported flags: g, i, m, s "
            "(this server uses Python's re engine; JS-only flags d, u, v, y are not supported)."
        )
    if len(set(flags)) != len(flags):
        raise WikiError("flags must not contain duplicates.")


def first_changed_line_diff(before, after):
    if before == after:
        return None

    before_lines = before.split("\n")
    after_lines = after.split("\n")
    for index in range(max(len(before_lines), len(after_lines))):
        before_line = before_lines[index] if index < len(before_lines) else ""
        after_line = after_lines[index] if index < len(after_lines) else ""
        if before_line != after_line:
            return {"line": index + 1, "before": before_line, "after": after_line}
    return None


def replace_regex(page_id, pattern, replacement, flags="g", locale="en"):
    validate_regex_flags(flags)
    py_flags = 0
    if "i" in flags:
        py_flags |= re.IGNORECASE
    if "m" in flags:
        py_flags |= re.MULTILINE
    if "s" in flags:
        py_flags |= re.DOTALL

    try:
        compiled = re.compile(pattern, py_flags)
    except re.error as error:
        raise WikiError(f"invalid regex: {error}") from error

    existing = resolve_page(id=page_id, locale=locale)
    original_content = existing.get("content") or ""
    is_global = "g" in flags
    match_count = len(compiled.findall(original_content)) if is_global else (1 if compiled.search(original_content) else 0)
    updated_content = compiled.sub(replacement, original_content, count=0 if is_global else 1)

    summary = {
        "page": {"id": existing["id"], "path": existing["path"], "locale": existing["locale"], "title": existing["title"]},
        "matches": match_count,
        "replacements": match_count,
        "changed": updated_content != original_content,
        "diff": first_changed_line_diff(original_content, updated_content),
    }

    if updated_content == original_content:
        return summary

    update_result = update_page(id=existing["id"], locale=existing["locale"], content=updated_content)
    return {**update_result, **summary}


def move_page(id=None, path=None, locale="en", destination_path=None, destination_locale=None):
    if not destination_path or not str(destination_path).strip():
        raise WikiError("destinationPath must be a non-empty string.")

    existing = resolve_page(id=id, path=path, locale=locale)
    dest_locale = destination_locale or existing["locale"]
    return graphql_request(
        MOVE_PAGE_MUTATION,
        {"id": existing["id"], "destinationPath": destination_path, "destinationLocale": dest_locale},
    )


def bulk_move_pages(moves, continue_on_error=True):
    if not moves:
        raise WikiError("Provide at least one move in moves.")

    results = []
    for move in moves:
        try:
            response = move_page(
                id=move.get("id"),
                path=move.get("path"),
                locale=move.get("locale") or "en",
                destination_path=move.get("destinationPath"),
                destination_locale=move.get("destinationLocale"),
            )
            results.append({"move": move, "succeeded": True, "response": response})
        except Exception as error:
            results.append({"move": move, "succeeded": False, "error": str(error)})
            if not continue_on_error:
                break

    return {
        "attempted": len(moves),
        "succeeded": sum(1 for r in results if r["succeeded"]),
        "failed": sum(1 for r in results if not r["succeeded"]),
        "results": results,
    }


def delete_page(id=None, path=None, locale="en"):
    existing = resolve_page(id=id, path=path, locale=locale)
    return graphql_request(DELETE_PAGE_MUTATION, {"id": existing["id"]})


def bulk_delete_pages(ids=None, paths=None, locale="en", continue_on_error=True):
    selectors = [{"id": i, "locale": locale} for i in (ids or [])] + [
        {"path": p, "locale": locale} for p in (paths or [])
    ]
    if not selectors:
        raise WikiError("Provide at least one id or path in ids/paths.")

    results = []
    for selector in selectors:
        try:
            response = delete_page(id=selector.get("id"), path=selector.get("path"), locale=selector["locale"])
            results.append({"selector": selector, "succeeded": True, "response": response})
        except Exception as error:
            results.append({"selector": selector, "succeeded": False, "error": str(error)})
            if not continue_on_error:
                break

    return {
        "locale": locale,
        "attempted": len(selectors),
        "succeeded": sum(1 for r in results if r["succeeded"]),
        "failed": sum(1 for r in results if not r["succeeded"]),
        "results": results,
    }


def id_or_none(value):
    return None if value is None else int(value)


def main():
    parser = argparse.ArgumentParser(description="Small Wiki.js GraphQL API helper.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    search = sub.add_parser("search-pages", help="Search pages by text.")
    search.add_argument("--query", required=True)
    search.add_argument("--locale", default="en")
    search.add_argument("--limit", type=int, default=10)
    search.add_argument("--path-prefix")
    search.add_argument("--order-by", choices=("updatedAt", "createdAt"))

    get = sub.add_parser("get-page", help="Get one page by path or id.")
    get.add_argument("--path")
    get.add_argument("--id", type=int)
    get.add_argument("--locale", default="en")

    bulk_get = sub.add_parser("bulk-get-pages", help="Get multiple pages.")
    bulk_get.add_argument("--ids", type=json.loads, default="[]")
    bulk_get.add_argument("--paths", type=json.loads, default="[]")
    bulk_get.add_argument("--locale", default="en")
    bulk_get.add_argument("--continue-on-error", action=argparse.BooleanOptionalAction, default=True)

    search_get = sub.add_parser("search-and-get-page", help="Search and return a single strong match.")
    search_get.add_argument("--query", required=True)
    search_get.add_argument("--locale", default="en")

    get_title = sub.add_parser("get-page-by-title", help="Get one page by title.")
    get_title.add_argument("--title", required=True)
    get_title.add_argument("--locale", default="en")

    listp = sub.add_parser("list-pages", help="List pages.")
    listp.add_argument("--locale", default="en")
    listp.add_argument("--path-prefix")
    listp.add_argument("--limit", type=int, default=50)
    listp.add_argument("--order-by", choices=("updatedAt", "createdAt"))

    create = sub.add_parser("create-page", help="Create a page.")
    create.add_argument("--path", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--content", required=True)
    create.add_argument("--description", default="")
    create.add_argument("--locale", default="en")
    create.add_argument("--tags", type=json.loads, default="[]")
    create.add_argument("--is-published", action=argparse.BooleanOptionalAction, default=True)
    create.add_argument("--is-private", action=argparse.BooleanOptionalAction, default=False)
    create.add_argument("--editor", default="markdown")

    bulk_create = sub.add_parser("bulk-create-pages", help="Create multiple pages.")
    bulk_create.add_argument("--pages", type=json.loads, required=True)
    bulk_create.add_argument("--continue-on-error", action=argparse.BooleanOptionalAction, default=True)

    update = sub.add_parser("update-page", help="Update a page by path or id.")
    update.add_argument("--path")
    update.add_argument("--id", type=int)
    update.add_argument("--title")
    update.add_argument("--content")
    update.add_argument("--description")
    update.add_argument("--locale")
    update.add_argument("--tags", type=json.loads, default=None)
    update.add_argument("--is-published", action=argparse.BooleanOptionalAction, default=None)
    update.add_argument("--is-private", action=argparse.BooleanOptionalAction, default=None)
    update.add_argument("--editor")

    bulk_update = sub.add_parser("bulk-update-pages", help="Update multiple pages.")
    bulk_update.add_argument("--updates", type=json.loads, required=True)
    bulk_update.add_argument("--continue-on-error", action=argparse.BooleanOptionalAction, default=True)

    regex = sub.add_parser("replace-regex", help="Replace text in a page using a regular expression.")
    regex.add_argument("--page-id", type=int, required=True)
    regex.add_argument("--pattern", required=True)
    regex.add_argument("--replacement", required=True)
    regex.add_argument("--flags", default="g")
    regex.add_argument("--locale", default="en")

    delete = sub.add_parser("delete-page", help="Delete a page by path or id.")
    delete.add_argument("--path")
    delete.add_argument("--id", type=int)
    delete.add_argument("--locale", default="en")

    move = sub.add_parser("move-page", help="Move a page by path or id.")
    move.add_argument("--path")
    move.add_argument("--id", type=int)
    move.add_argument("--locale", default="en")
    move.add_argument("--destination-path", required=True)
    move.add_argument("--destination-locale")

    bulk_move = sub.add_parser("bulk-move-pages", help="Move multiple pages.")
    bulk_move.add_argument("--moves", type=json.loads, required=True)
    bulk_move.add_argument("--continue-on-error", action=argparse.BooleanOptionalAction, default=True)

    bulk_delete = sub.add_parser("bulk-delete-pages", help="Delete multiple pages.")
    bulk_delete.add_argument("--ids", type=json.loads, default="[]")
    bulk_delete.add_argument("--paths", type=json.loads, default="[]")
    bulk_delete.add_argument("--locale", default="en")
    bulk_delete.add_argument("--continue-on-error", action=argparse.BooleanOptionalAction, default=True)

    gql = sub.add_parser("graphql", help="Run a raw GraphQL query or mutation.")
    gql.add_argument("--query", required=True)
    gql.add_argument("--variables", type=json.loads, default="{}")

    args = parser.parse_args()

    try:
        if args.cmd == "search-pages":
            result = search_pages(args.query, args.locale, args.limit, args.path_prefix, args.order_by)
        elif args.cmd == "get-page":
            result = get_page(id=args.id, path=args.path, locale=args.locale)
        elif args.cmd == "bulk-get-pages":
            result = bulk_get_pages(args.ids, args.paths, args.locale, args.continue_on_error)
        elif args.cmd == "search-and-get-page":
            result = search_and_get_page(args.query, args.locale)
        elif args.cmd == "get-page-by-title":
            result = get_page_by_title(args.title, args.locale)
        elif args.cmd == "list-pages":
            result = list_pages(args.locale, args.path_prefix, args.limit, args.order_by)
        elif args.cmd == "create-page":
            result = create_page(
                args.path, args.title, args.content, args.description, args.locale,
                args.tags, args.is_published, args.is_private, args.editor,
            )
        elif args.cmd == "bulk-create-pages":
            result = bulk_create_pages(args.pages, args.continue_on_error)
        elif args.cmd == "update-page":
            result = update_page(
                id=args.id, path=args.path, title=args.title, content=args.content,
                description=args.description, locale=args.locale, tags=args.tags,
                is_published=args.is_published, is_private=args.is_private, editor=args.editor,
            )
        elif args.cmd == "bulk-update-pages":
            result = bulk_update_pages(args.updates, args.continue_on_error)
        elif args.cmd == "replace-regex":
            result = replace_regex(args.page_id, args.pattern, args.replacement, args.flags, args.locale)
        elif args.cmd == "delete-page":
            result = delete_page(id=args.id, path=args.path, locale=args.locale)
        elif args.cmd == "move-page":
            result = move_page(
                id=args.id, path=args.path, locale=args.locale,
                destination_path=args.destination_path, destination_locale=args.destination_locale,
            )
        elif args.cmd == "bulk-move-pages":
            result = bulk_move_pages(args.moves, args.continue_on_error)
        elif args.cmd == "bulk-delete-pages":
            result = bulk_delete_pages(args.ids, args.paths, args.locale, args.continue_on_error)
        elif args.cmd == "graphql":
            result = graphql_request(args.query, args.variables)
    except WikiError as error:
        print(json.dumps({"error": str(error)}, indent=2), file=sys.stderr)
        raise SystemExit(1) from error

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
