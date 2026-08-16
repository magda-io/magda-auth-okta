# magda-auth-okta

![Version: 2.0.0-pr.4.0](https://img.shields.io/badge/Version-2.0.0--pr.4.0-informational?style=flat-square)

A Magda Authentication Plugin for Okta.

## Version Compatibility

Pick the chart version that matches your Magda release:

| This chart | Requires Magda | Notes |
| ---------- | -------------- | ----- |
| **`v2.x`** (from `v2.0.0-alpha.0`) | **v7.0.0 or above** | Connects to `session-db` over **TLS** when the database enforces SSL. Uses the versioned `magda.db-client-sslmode-env-v1` Helm helper contract plus `magda.db-client-ca-env-v1` for `sslmode: verify-ca`/`verify-full` server-certificate verification (needs `magda-core` `>= 7.0.0-alpha.1`), and runs on **Node.js 22**. |
| **`v1.x`** | **v6.x or below** (v0.0.58+) | Use this line if you run **Magda v6 or lower**. Does not emit `PGSSLMODE` and will not work against an SSL-enforced external database. |

> ⚠️ **`v2.x` is a breaking change and requires Magda v7+** (on the v7 pre-release line, **`>= 7.0.0-alpha.1`**, which first shipped the `db-client-ca-env-v1` contract this chart now calls). Do **not** deploy `v2.x` alongside Magda v6 or lower, or an earlier v7 alpha — the required helper contracts are only provided by a recent enough `magda-core`, and rendering will fail closed with `no template "magda.compatibility-check" associated` or a contract-not-supported error (this is intentional — the render-time compatibility handshake is controlled by `global.magdaCompatibilityCheck`, default `true`; see the [Magda Helm Helper Contracts](https://github.com/magda-io/magda/blob/next/docs/docs/helm-helper-contracts.md) documentation).

> **Deploy as a chart dependency in the same Helm release as Magda** (not a separate `helm install`), so the `magda.compatibility-check` template resolves.

### How to Use

1. Add the auth plugin as a [Helm Chart Dependency](https://helm.sh/docs/helm/helm_dependency/)
```yaml
- name: magda-auth-okta
  version: 1.1.0
  repository: https://charts.magda.io
  tags:
    - all
    - magda-auth-okta
```

2. Config the auth plugin with Okta client Id & domain
```yaml
magda-auth-okta:
  domain: dev-xxxxxx.okta.com
  clientId: "xxxxxxxx"
```

3. Config Gatway to add the auth plugin to Gateway's plugin list (More details see [here](https://github.com/magda-io/magda/blob/master/deploy/helm/internal-charts/gateway/README.md))
```yaml
gateway:
  authPlugins:
  - key: okta
    baseUrl: http://magda-auth-okta
```

4. Make sure `oauth-secrets` secret has the correct value for `okta-client-secret` key

5. Identity provider setup:

Login return uri: https://[Magda External Access Domain]/auth/login/plugin/okta/return
Logout return uri: https://[Magda External Access Domain]/auth/login/plugin/okta/logout/return

## Requirements

Kubernetes: `>= 1.14.0-0`

| Repository | Name | Version |
|------------|------|---------|
| oci://ghcr.io/magda-io/charts | magda-common | 7.0.0-alpha.1 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| authPluginConfig.authenticationMethod | string | `"IDP-URI-REDIRECTION"` | The authentication method of the plugin. Support values are: <ul> <li>`IDP-URI-REDIRECTION`: the plugin will rediredct user agent to idp (identity provider) for authentication. e.g. Google & fackebook oauth etc.</li> <li>`PASSWORD`: the plugin expect frontend do a form post that contains username & password to the plugin for authentication.</li> <li>`QR-CODE`: the plugin offers a url that is used by the frontend to request auth challenge data. The data will be encoded into a QR-code image and expect the user scan the QR code with a mobile app to complete the authentication request.</li> </ul> See [Authentication Plugin Specification](https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md) for more details |
| authPluginConfig.explicitLogout | bool | `true` | whether explicitly logout okta session when user is logged out from Magda |
| authPluginConfig.iconUrl | string | `"/icon.svg"` | the display icon URL of the auth plugin. |
| authPluginConfig.key | string | `"okta"` | the unique key of the auth plugin. Allowed characters: [a-zA-Z0-9\-] |
| authPluginConfig.loginFormExtraInfoContent | string | `""` | Optional; Only applicable when authenticationMethod = "PASSWORD". If present, will displayed the content underneath the login form to provide extra info to users. e.g. how to reset password Can support content in markdown format. |
| authPluginConfig.loginFormExtraInfoHeading | string | `""` | Optional; Only applicable when authenticationMethod = "PASSWORD". If present, will displayed the heading underneath the login form to provide extra info to users. e.g. how to reset password |
| authPluginConfig.loginFormPasswordFieldLabel | string | "Password" | Optional; Only applicable when authenticationMethod = "PASSWORD". |
| authPluginConfig.loginFormUsernameFieldLabel | string | "Username" | Optional; Only applicable when authenticationMethod = "PASSWORD". |
| authPluginConfig.name | string | `"Okta"` | the display name of the auth plugin. |
| authPluginConfig.qrCodeAuthResultPollUrl | string | `""` | Only applicable & compulsory when authenticationMethod = "QR-CODE". The url that is used by frontend to poll the authentication processing result. See [Authentication Plugin Specification](https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md) for more details |
| authPluginConfig.qrCodeExtraInfoContent | string | `""` | Only applicable & compulsory when authenticationMethod = "QR-CODE". If present, will displayed the content underneath the login form to provide extra info to users. e.g. how to download moile app to scan the QR Code. Can support content in markdown format. |
| authPluginConfig.qrCodeExtraInfoHeading | string | `""` | Only applicable & compulsory when authenticationMethod = "QR-CODE". If present, will displayed the heading underneath the QR Code image to provide extra instruction to users. e.g. how to download moile app to scan the QR Code |
| authPluginConfig.qrCodeImgDataRequestUrl | string | `""` | Only applicable & compulsory when authenticationMethod = "QR-CODE". The url that is used by frontend client to request auth challenge data from the authentication plugin. See [Authentication Plugin Specification](https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md) for more details |
| authPluginRedirectUrl | string | `nil` | the redirection url after the whole authentication process is completed. Authentication Plugins will use this value as default. The following query paramaters can be used to supply the authentication result: <ul> <li>result: (string) Compulsory. Possible value: "success" or "failure". </li> <li>errorMessage: (string) Optional. Text message to provide more information on the error to the user. </li> </ul> This field is for overriding the value set by `global.authPluginRedirectUrl`. Unless you want to have a different value only for this auth plugin, you shouldn't set this value. |
| autoscaler.enabled | bool | `false` | turn on the autoscaler or not |
| autoscaler.maxReplicas | int | `3` |  |
| autoscaler.minReplicas | int | `1` |  |
| autoscaler.targetCPUUtilizationPercentage | int | `80` |  |
| clientId | string | `nil` | okta clientId |
| defaultAdminUserId | string | `"00000000-0000-4000-8000-000000000000"` | which system account we used to talk to auth api The value of this field will only be used when `global.defaultAdminUserId` has no value |
| defaultImage.imagePullSecret | bool | `false` |  |
| defaultImage.pullPolicy | string | `"IfNotPresent"` |  |
| defaultImage.repository | string | `"ghcr.io/magda-io"` |  |
| domain | string | `nil` | okta domain. Used to generate issuer url (i.e. `https://{yourOktaDomain}/oauth2/default`). You can skip this field and provide value for `issuer` field directly instead. |
| global | object | `{"authPluginRedirectUrl":"/sign-in-redirect","externalUrl":"","image":{},"magdaCompatibilityCheck":true,"rollingUpdate":{}}` | only for providing appropriate default value for helm lint |
| global.magdaCompatibilityCheck | bool | `true` | Whether to run the Magda Helm helper-contract compatibility check. Leave as `true` in normal deployments alongside Magda v7+; set to `false` (unquoted) only for a standalone `helm template`/`helm lint` (no magda-core). See https://github.com/magda-io/magda/blob/next/docs/docs/helm-helper-contracts.md |
| image.name | string | `"magda-auth-okta"` |  |
| issuer | string | `nil` | okta issuer url. When okta `domain` is provided, the `issuer` value can be omitted and will be default to "https://{yourOktaDomain}/oauth2/default" |
| maxClockSkew | string | `nil` | Okat openid client clock skew tolerance (in seconds). Default to 120 if not provided |
| replicas | int | `1` | no. of initial replicas |
| resources.limits.cpu | string | `"50m"` |  |
| resources.requests.cpu | string | `"10m"` |  |
| resources.requests.memory | string | `"30Mi"` |  |
| scope | string | `nil` | okta openid access token scope. Default to `openid profile email` if not provided. More see: https://developer.okta.com/docs/reference/api/oidc/#scopes |
| timeout | string | `nil` | Okat openid client HTTP request timeout (in milseconds).  Default to 10000 if not provided. |
