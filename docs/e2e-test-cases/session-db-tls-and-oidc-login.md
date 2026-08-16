# E2E Test Case: session-db TLS (incl. `verify-full`) + full OIDC login (Magda v7)

An end-to-end case that verifies, against a real cluster (e.g. minikube):

1. The plugin connects to `session-db` over **TLS**, including `sslmode: verify-full`
   server-certificate verification (via the `magda.db-client-ca-env-v1` contract).
2. A **complete OpenID Connect login** works through the modernized
   `openid-client` v4 stack (discovery → authorize → code exchange → ID-token
   validation → userinfo → Magda user + session), exercising the ESM / Node 22
   build end to end.

Because a real OIDC identity provider needs registered clients and interactive
consent, the login is driven against an **in-cluster mock IdP**
([`navikt/mock-oauth2-server`](https://github.com/navikt/mock-oauth2-server)),
which serves discovery/JWKS and issues tokens without a real user account.

## Setup

Deploy Magda v7 + this plugin in **one** Helm release (so the helper-contract
compatibility check resolves), with `verify-full` + a CA secret. Substitute your
built versions for `<PLUGIN_VERSION>` (e.g. `2.0.0-pr.4.0`) and `<MAGDA_VERSION>`
(e.g. `7.0.0-alpha.1`).

### 1. Mock OIDC provider

```bash
kubectl apply -n magda -f - <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata: { name: mock-oidc }
spec:
  replicas: 1
  selector: { matchLabels: { app: mock-oidc } }
  template:
    metadata: { labels: { app: mock-oidc } }
    spec:
      containers:
        - name: mock-oidc
          image: ghcr.io/navikt/mock-oauth2-server:2.1.10
          ports: [ { containerPort: 8080 } ]
          env: [ { name: SERVER_PORT, value: "8080" } ]
---
apiVersion: v1
kind: Service
metadata: { name: mock-oidc }
spec:
  selector: { app: mock-oidc }
  ports: [ { port: 8080, targetPort: 8080 } ]
YAML
# discovery should return issuer http://mock-oidc:8080/default
```

### 2. CA secret (in-cluster combined-db CA — its SANs already cover session-db)

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
kubectl exec -n magda "$DBPOD" -c postgresql -- cat /opt/bitnami/postgresql/certs/ca.crt > /tmp/pg-ca.crt
kubectl create secret generic pg-ca -n magda --from-file=ca.crt=/tmp/pg-ca.crt
```

### 3. Umbrella values

```yaml
global:
  magdaCompatibilityCheck: true
  externalUrl: "http://localhost:6100"
  postgresql:
    client:
      sslmode: verify-full
      sslRootCertSecret: { name: pg-ca, key: ca.crt }
magda-auth-okta:
  clientId: "magda-e2e-okta-client"          # mock-oauth2-server accepts any client
  issuer: "http://mock-oidc:8080/default"
  image: { tag: "<PLUGIN_VERSION>" }
magda:
  magda-core:
    gateway:
      authPlugins:
        - { key: okta, baseUrl: http://magda-auth-okta }
```

A fake client secret must exist: `kubectl create secret generic oauth-secrets -n magda --from-literal=okta-client-secret=e2e` (key `okta-client-secret`).

Install/upgrade the umbrella and wait. The plugin pod should reach `Listening on
port 80` (it discovered the mock issuer — proving `openid-client` v4 discovery +
the ESM build work).

## Assertions

### A. verify-full CA delivered + DB connection is TLS

```bash
kubectl get deploy magda-auth-okta -n magda \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' | grep PGSSL
# PGSSLMODE=verify-full
# PGSSLROOTCERT=/etc/magda/postgresql-ca/root.crt
```

Drive the SDK's own session store to write under verify-full (the exact
`session-db` code a real login uses), asserting the row count increases:

```bash
DBPOD=$(kubectl get pod -n magda -l app.kubernetes.io/name=combined-db-postgresql-pg17 -o name | head -1)
before=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c 'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d session -tAc "SELECT count(*) FROM session;"')
kubectl exec -n magda deploy/magda-auth-okta -- node --input-type=module -e '
import express from "express"; import http from "http";
import { createMagdaSessionRouter } from "@magda/authentication-plugin-sdk";
const app = express();
app.use(createMagdaSessionRouter({ sessionSecret:"e2e", sessionDBHost:"session-db", sessionDBPort:5432 }));
app.get("/w",(req,res)=>{ req.session.e2e="okta-vf-"+Date.now(); res.end("ok"); });
const s=app.listen(0,()=>{const p=s.address().port;http.get("http://127.0.0.1:"+p+"/w",r=>{r.on("data",()=>{});r.on("end",()=>setTimeout(()=>{console.log("SDK write status "+r.statusCode);s.close();process.exit(0);},2000));});});'
after=$(kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c 'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d session -tAc "SELECT count(*) FROM session;"')
echo "session rows: $before -> $after"     # increases by one
```

The live connection is TLS:

```bash
IP=$(kubectl get pod -n magda -l service=magda-auth-okta --field-selector=status.phase=Running -o jsonpath='{.items[0].status.podIP}')
kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
  "PGPASSWORD=\$(cat \$POSTGRES_PASSWORD_FILE) psql -U postgres -tAc \"
     SELECT a.datname,a.usename,s.ssl,s.version FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
     WHERE host(a.client_addr)='$IP';\""
# -> session|client|t|TLSv1.3
```

### B. Full OIDC login (openid-client v4, code + PKCE)

```bash
kubectl port-forward -n magda svc/magda-auth-okta 18200:80 &
kubectl port-forward -n magda svc/mock-oidc 18201:8080 &

# 1. Initiate: plugin 302s to the mock authorize endpoint (writes OIDC state/PKCE to session-db).
curl -s -o /dev/null -D /tmp/init.txt -c /tmp/cj.txt -H "X-Forwarded-Proto: https" http://localhost:18200/
AUTHZ=$(grep -i '^location' /tmp/init.txt | sed 's/[Ll]ocation: //I' | tr -d '\r' | sed 's|http://mock-oidc:8080|http://localhost:18201|')

# 2. Approve at the mock login form -> 302 back to redirect_uri?code=...
curl -s -o /dev/null -D /tmp/authz.txt \
  --data-urlencode "username=magda-okta-user" \
  --data-urlencode 'claims={"sub":"magda-okta-user","email":"magda-okta-user@example.com","name":"Magda E2E User"}' \
  "$AUTHZ"
CODE=$(grep -i '^location' /tmp/authz.txt | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p' | tr -d '\r')
STATE=$(grep -i '^location' /tmp/authz.txt | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p' | tr -d '\r')

# 3. Callback: plugin exchanges the code at the mock token endpoint (server-side, openid-client v4),
#    validates the ID token, fetches userinfo, creates the Magda user, writes the session.
curl -s -o /dev/null -D /tmp/ret.txt -b /tmp/cj.txt -H "X-Forwarded-Proto: https" \
  "http://localhost:18200/return?code=${CODE}&state=${STATE}"
grep -iE '^HTTP|^location' /tmp/ret.txt
```

Expected: `HTTP/1.1 302 Found` / `Location: /sign-in-redirect?result=success`.

### C. The login created a Magda user + session

```bash
kubectl exec -n magda "$DBPOD" -c postgresql -- bash -c \
  'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d auth -tAc "SELECT email, \"displayName\", source FROM users WHERE source='"'"'oidc'"'"';"'
# -> magda-okta-user@example.com|Magda E2E User|oidc
```

## Result

Verified on minikube with Magda `7.0.0-alpha.1` and the plugin
(`2.0.0-pr.4.0`): under `verify-full` the plugin received the CA and its
`session-db` connection was `ssl = t`/`TLSv1.3`; a full OIDC authorization-code
login (with PKCE) completed through `openid-client` v4 — `result=success`, a
`source=okta` Magda user was created, and the authenticated session was
persisted.

## Cleanup

```bash
kubectl delete deploy,svc mock-oidc -n magda
kubectl delete secret pg-ca oauth-secrets -n magda
# then uninstall the release + namespace as usual
```
