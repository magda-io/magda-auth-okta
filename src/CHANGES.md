# 2.0.0

- Enforce TLS on the `session-db` connection when deployed against an enforced-SSL database (magda-io/magda#3742):
  - Upgrade `@magda/authentication-plugin-sdk` + the `magda-common` Helm chart dependency to v7 (`7.0.0-alpha.1`), and include the `magda.db-client-sslmode-env-v1` helper contract so the pod receives `PGSSLMODE`. The v7 SDK derives the `node-postgres` `ssl` option from `PGSSLMODE`/`PGSSLROOTCERT` explicitly.
  - Support `sslmode: verify-ca`/`verify-full` via the `magda.db-client-ca-env-v1` helper contract (mount the server CA + set `PGSSLROOTCERT`). Self-guarded under `disable`/`require`.
  - Add `global.magdaCompatibilityCheck` (default `true`); the `helm-lint` script sets it `false` for the standalone render. Point the `magda-common` dependency at `oci://ghcr.io/magda-io/charts` and default the image to `ghcr.io/magda-io`.
- Modernize the toolchain: build as an **ES module**, upgrade to **Node.js 22**, TypeScript 5, `tsx`/mocha 10, `@magda/docker-utils` v5, `passport` 0.7, and `openid-client` v4.
- Modernize CI: replace the old S3/`charts.magda.io` + docker.io release workflow with the current ghcr.io OCI flow, and add the `set-version` workflow.
- **Requires Magda v7+** (breaking change; on the v7 pre-release line, `>= 7.0.0-alpha.1`). Deploy as a chart dependency in the same Helm release as Magda. Users on Magda v6 or lower should stay on the `1.x` line.

# 1.1.1

- make sure timeout setting apply to all HTTP connections
- Upgrade to magda-common lib chart v1.0.0

# 1.1.0

- Upgrade dependencies
- Upgrade to magda-common lib chart v1.0.0-alpha.4
- Use named templates from magda-common lib chart for docker image related logic

# 1.0.6

- Upgrade @magda/authentication-plugin-sdk to 0.0.60-alpha.12

# 1.0.5

- #1 Added logout process support