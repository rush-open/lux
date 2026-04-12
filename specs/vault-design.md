# Vault Design — Unified Credential Management

## Architecture

### Dual-Layer Vault

| Scope | Manager | User-Visible | Purpose |
|-------|---------|-------------|---------|
| **Platform** | Admin / control-plane | No | Bedrock keys, S3 access, internal tokens |
| **User** | End user | Yes | Personal GitHub token, custom API keys |

### Runtime Merge

When resolving credentials for a sandbox:
1. Load Platform Vault entries
2. Load User Vault entries (filtered by userId)
3. User entries override Platform entries on same `injectionTarget`
4. Result: flat `Record<string, string>` injected as env vars

### Credential Types

| Type | Injection | Key in Container? |
|------|-----------|-------------------|
| `env_var` | Direct env injection | Yes |
| `anthropic_api` | env injection (MVP) / Credential Proxy (future) | Yes (MVP) |
| `aws_bedrock` | env injection (ARN + AWS keys) | Yes |
| `custom_endpoint` | env injection (MVP) / Credential Proxy (future) | Yes (MVP) |
| `git_token` | GIT_ASKPASS temp script | Controlled |
| `npm_token` | Temp .npmrc | Controlled |
| `http_bearer` | Credential Proxy (future) | No (future) |

### DB Schema

Uses existing `vault_entries` table with:
- `scope`: 'platform' | 'project' (project-scoped entries belong to user vault within a project)
- `owner_id`: userId for user-owned entries, NULL for platform
- `credential_type`: one of the types above
- `injection_target`: env var name to inject as
- `encrypted_value`: AES-256-GCM encrypted

### Constraints

- Per-vault max 20 credentials (application-level enforcement)
- Secret fields are write-only (API never returns decrypted values)
- Platform entries visible only to admin
- User entries visible only to owner

### Merge Priority (resolveForSandbox)

```
Platform entries (base) → User entries (override by injectionTarget)
```

Example:
- Platform: `ANTHROPIC_API_KEY = sk-ant-platform-xxx`
- User: `ANTHROPIC_API_KEY = sk-ant-personal-xxx`
- Result: `ANTHROPIC_API_KEY = sk-ant-personal-xxx` (user wins)
