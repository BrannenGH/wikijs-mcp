# Keycloak Dynamic Client Registration Fix

This fixes errors like:

```text
Dynamic client registration failed: registration endpoint returned 403
(insufficient_scope: Policy 'Trusted Hosts' rejected request to client-...)
```

The error means Keycloak's client registration policy rejected one of the
hosts in the dynamic registration request, usually from a `redirect_uri`,
`client_uri`, `logo_uri`, or similar URL field.

## Configure Trusted Hosts

1. Open the Keycloak Admin Console.
2. Select the `Ironwood` realm.
3. Go to `Realm settings`.
4. Open `Client registration`.
5. Open `Client registration policies`.
6. Check both policy groups:
   - `Anonymous`
   - `Authenticated`
7. Open the policy named `Trusted Hosts`.
8. Add the hosts used by MCP/OAuth clients:

```text
localhost
127.0.0.1
::1
wiki.example.com
```

## Important Notes

- If the MCP client registers anonymously, the `Anonymous` policy group applies.
- If the MCP client uses an initial access token, the `Authenticated` policy
  group applies.
- Desktop OAuth clients often need loopback redirect hosts such as `localhost`,
  `127.0.0.1`, or `::1`.
- If Keycloak has an option like `Host Sending Registration Request Must Match`,
  leave it disabled unless you explicitly need that restriction. It can block
  desktop clients because the registration request may come from one host while
  registering a loopback redirect URI.

After updating the policy, retry the MCP client connection. If it still fails,
check the dynamic client registration payload or Keycloak logs; the rejected
host will be one of the URI fields in that request.
