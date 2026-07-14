# wikijs-mcp

MCP server exposing Wiki.js over Streamable HTTP.

## Setup

1. In Wiki.js, go to Admin Area -> API Access, enable API access, and generate an API key.
2. `cp wikijs.env.example wikijs.env` and fill in your Wiki.js URL and API token.
3. `docker compose up -d --build`

## Verify

```bash
curl -s http://localhost:5094/healthz
```

This server has no built-in authentication. If you expose it beyond
localhost, put it behind your own auth layer (reverse proxy, VPN, etc.)
before pointing an MCP client at it.

## Tools

- `wikijs_search_pages`: search pages by text.
- `wikijs_get_page`: fetch one page by `path` or Wiki.js `id`, returning content and page metadata.
- `wikijs_bulk_get_pages`: fetch multiple pages in one call via `ids` and/or `paths`; continues past individual failures by default (`continue_on_error`) and returns a per-page success/failure summary.
- `wikijs_search_and_get_page`: search pages and return full content when there is one strong match; otherwise return ranked snippets.
- `wikijs_get_page_by_title`: fetch one page by title, with closest-match suggestions when ambiguous.
- `wikijs_list_pages`: list pages for a locale, optionally filtered by `path_prefix` and sorted by `updatedAt` or `createdAt`.
- `wikijs_create_page` / `wikijs_bulk_create_pages`: create pages.
- `wikijs_update_page` / `wikijs_bulk_update_pages`: update pages by `path` or `id`; omitted fields keep their existing values.
- `wikijs_replace_regex`: update a page with `page_id`, `pattern`, `replacement`, and optional regex `flags` (`g`, `i`, `m`, `s`); returns `matches`, `replacements`, `changed`, and a compact first-line `diff`.
- `wikijs_move_page` / `wikijs_bulk_move_pages`: rename/relocate pages.
- `wikijs_delete_page` / `wikijs_bulk_delete_pages`: delete pages.
- `wikijs_graphql`: run a raw Wiki.js GraphQL query or mutation for advanced/admin cases.

All bulk tools accept `continue_on_error` (default `true`) and return a
per-item success/failure summary instead of aborting on the first error.
