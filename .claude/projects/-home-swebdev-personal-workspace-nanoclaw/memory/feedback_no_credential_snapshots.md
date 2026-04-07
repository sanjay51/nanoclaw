---
name: No credential snapshots in containers
description: Never cache or copy credentials into container IPC — always fetch fresh from host API on demand
type: feedback
---

Do not keep copies of credentials in the container. Always re-retrieve them from the host when needed.

**Why:** User has repeatedly asked for credential updates to be picked up immediately. Snapshot files become stale and cause the agent to use outdated credentials even after the user updates them.

**How to apply:** The container's `get_credentials` tool fetches via HTTP from the host web API (`/api/internal/credentials`) on every call. No `credentials.json` snapshot file is written to the IPC directory. The `NANOCLAW_CREDENTIALS_URL` env var is passed to the container at launch.
