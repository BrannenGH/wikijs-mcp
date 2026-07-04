# Wiki.js Deployment

This stack runs Wiki.js behind Keycloak-backed browser authentication and exposes a separate MCP HTTP endpoint for API clients that present a Keycloak JWT.

## Files

- `docker-compose.yml`: Wiki.js, Postgres, oauth2-proxy, and the MCP proxy (`wikijs-mcp` + `wikijs-mcp-auth`).
- `.env.example`: required runtime settings and secrets.
- `caddy.example.Caddyfile`: Caddy route snippet for `wiki.example.com`.
- `mcp-proxy/`: small MCP JSON-RPC proxy for Wiki.js GraphQL, run as the `wikijs-mcp` container. It has no auth logic of its own and is not reachable from outside the compose network.

## Storage

Persistent data is under `/media/data/wikijs`:

- `/media/data/wikijs/postgres`: Wiki.js database.
- `/media/data/wikijs/uploads`: Wiki.js uploads.

The existing `/media/data/wiki` tree is mounted read-only at `/media/data/wiki` for import/reference.

## Keycloak Setup

Create two clients in the realm behind `https://keycloak.example.com`.

For browser SSO:

- Client ID: `wikijs-ui`
- Type: confidential
- Valid redirect URI: `https://wiki.example.com/oauth2/callback`
- Web origin: `https://wiki.example.com`

MCP/API clients (Claude, etc.) register themselves dynamically against this
realm rather than using a pre-created client (see
`keycloak-dynamic-client-registration.md`). `wikijs-mcp-auth` validates the
token's signature and issuer only — leave `KEYCLOAK_MCP_AUDIENCE` unset, same
as the other MCP services in `/opt/mcp`, since dynamically-registered clients'
tokens don't carry a custom audience claim and enforcing one rejects them.
Only set it if your realm is configured to stamp that audience onto every
issued token regardless of client.

The browser path is protected by oauth2-proxy before traffic reaches Wiki.js. For full in-app SSO, also enable the OpenID Connect authentication strategy inside Wiki.js after initial setup, using the same Keycloak realm and a Wiki.js OIDC client.

## Start

```bash
cp .env.example .env
mkdir -p /media/data/wikijs/postgres /media/data/wikijs/uploads
docker compose up -d --build
```

Point Caddy at the ports shown in `caddy.example.Caddyfile`. The `/mcp`, `/api/*`, `/openapi.json`, and discovery paths under `/.well-known/` must route to the `wikijs-mcp-auth` port (`MCP_PORT`); that container validates the bearer token and forwards to `wikijs-mcp` internally. The rest of the site should route to oauth2-proxy/Wiki.js. If Caddy is not running on the same host as this compose stack, set `WIKI_BIND_ADDR` and `MCP_BIND_ADDR` to this host's reachable LAN address, such as `192.168.1.10`.

After the first Wiki.js admin setup, create a Wiki.js API token and put it in `WIKIJS_API_TOKEN`, then restart the MCP proxy:

```bash
docker compose up -d wikijs-mcp
```

## MCP Endpoint

Configure API clients to use:

```text
https://wiki.example.com/mcp
```

Every MCP request must include:

```text
Authorization: Bearer <Keycloak JWT>
```

Authentication is handled entirely by the `wikijs-mcp-auth` sidecar (the same
`ghcr.io/brannengh/jwt-proxy:latest` image used by every MCP service in
`/opt/mcp`), not by the `wikijs-mcp` proxy itself. It rejects requests with no
token, an invalid issuer, or the wrong audience, then forwards validated
requests to `wikijs-mcp` over the internal compose network — `wikijs-mcp` is
not published on any host port and trusts everything it receives.

The MCP server exposes page-oriented actions instead of requiring callers to hand-write
GraphQL for common work:

- `wikijs_search_pages`: search pages by text.
- `wikijs_get_page`: fetch one page by `path` or Wiki.js `id`, returning content and page metadata.
- `wikijs_bulk_get_pages`: fetch multiple pages in one call via `ids` and/or `paths`; continues past individual failures by default (`continueOnError`) and returns a per-page success/failure summary.
- `wikijs_search_and_get_page`: search pages and return full content when there is one strong match; otherwise return ranked snippets.
- `wikijs_get_page_by_title`: fetch one page by title, with closest-match suggestions when ambiguous.
- `wikijs_list_pages`: list pages for a locale, optionally filtered by `pathPrefix` and sorted by `updatedAt` or `createdAt`.
- `wikijs_create_page`: create a markdown page.
- `wikijs_update_page`: update an existing page by `path` or `id`; omitted fields keep their existing values.
- `wikijs_bulk_update_pages`: update multiple pages in one call via `updates`; continues past individual failures by default (`continueOnError`) and returns a per-page success/failure summary.
- `wikijs_replace_regex`: update a page with `page_id`, `pattern`, `replacement`, and optional JavaScript regex `flags`; returns `matches`, `replacements`, `changed`, and a compact first-line `diff`.
- `wikijs_delete_page`: delete a page by `path` or `id`.
- `wikijs_bulk_delete_pages`: delete multiple pages in one call via `ids` and/or `paths`; continues past individual failures by default (`continueOnError`) and returns a per-page success/failure summary.
- `wikijs_graphql`: run a raw Wiki.js GraphQL query or mutation for advanced/admin cases.

Read and write tools authenticate MCP callers via `wikijs-mcp-auth`'s Keycloak bearer token check, then `wikijs-mcp` calls Wiki.js GraphQL with `WIKIJS_API_TOKEN`. Callers do not need a separate Wiki.js browser login/session.

OAuth-aware MCP clients can discover authentication using:

```text
https://wiki.example.com/.well-known/oauth-protected-resource/mcp
```

For older clients that probe authorization-server metadata at the MCP host, `wikijs-mcp-auth` also serves:

```text
https://wiki.example.com/.well-known/oauth-authorization-server
```

GPT Actions / OpenAPI clients can refresh their action schema from:

```text
https://wiki.example.com/mcp
```

The dedicated REST OpenAPI schema is also available at `/openapi.json` when
that path is routed to the MCP proxy.
