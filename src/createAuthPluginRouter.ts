import express, { Router } from "express";
import passport, { Authenticator } from "passport";
import { default as ApiClient } from "@magda/auth-api-client";
import {
    AuthPluginConfig,
    getAbsoluteUrl,
    redirectOnSuccess,
    redirectOnError,
    createOrGetUserToken,
    destroyMagdaSession,
    CookieOptions
} from "@magda/authentication-plugin-sdk";
import OpenIdClient, {
    Issuer,
    custom,
    Strategy as OpenIdClientStrategy,
    TokenSet
} from "openid-client";
import os from "os";
const pkg = require("../package.json");

declare module "@magda/authentication-plugin-sdk" {
    // we do declaration merging here
    interface AuthPluginConfig {
        explicitLogout: boolean;
    }
}

const OKTA_DEFAULT_TIMEOUT = 10000;
const OKTA_DEFAULT_MAX_CLOCK_SKEW = 120;
const STRATEGY_NAME = "okta-oidc";
const DEFAULT_SCOPE = "openid profile email";

export interface AuthPluginRouterOptions {
    authorizationApi: ApiClient;
    passport: Authenticator;
    issuer: string; // e.g. https://{yourOktaDomain}/oauth2/default
    clientId: string; // clientId that might be required by your IDP provider
    clientSecret: string; // clientSecret that might be required by your IDP provider
    externalUrl: string;
    authPluginRedirectUrl: string;
    authPluginConfig: AuthPluginConfig;
    timeout?: number; // timeout of openid client. Default 10000 milseconds
    /**
     * Defaults to 120.
     * This is the maximum difference allowed between your server's clock and Okta's in seconds.
     * Setting this to 0 is not recommended, because it increases the likelihood that valid jwts will fail verification due to nbf and exp issues.
     */
    maxClockSkew?: number;
    /**
     * Defaults to openid, which will only return the sub claim.
     * To obtain more information about the user, use openid profile.
     * For a list of scopes and claims, please see [S]cope-dependent claims](https://developer.okta.com/standards/OIDC/index.html#scope-dependent-claims-not-always-returned) for more information.
     */
    scope?: string;
    sessionCookieOptions: CookieOptions;
}

/**
 * Modified from @okta/oidc-middleware Apache 2.0 license
 * Change UserAgent header of OpenIdClient
 *
 * @param {OpenIdClient.HttpOptions} options
 * @return {*}
 */
function customizeUserAgent(options: OpenIdClient.HttpOptions) {
    /**
     * Parse out the default user agent for the openid-client library, which currently looks like:
     *
     * openid-client/1.15.0 (https://github.com/panva/node-openid-client)
     *
     * We strip off the github link because it's not necessary.
     */
    options = options || {};
    const headers = options.headers || {};
    let clientUserAgent = headers["User-Agent"];
    if (typeof clientUserAgent === "string") {
        clientUserAgent = " " + clientUserAgent.split(" ")[0];
    } else {
        clientUserAgent = "";
    }

    const userAgent = `${pkg.name}/${pkg.version}${clientUserAgent} node/${
        process.versions.node
    } ${os.platform()}/${os.release()}`;
    headers["User-Agent"] = userAgent;

    options.headers = headers;
    return options;
}

async function createOpenIdClient(options: AuthPluginRouterOptions) {
    console.log("Creating OpenId Client...");

    const externalUrl = options.externalUrl;
    const loginBaseUrl = getAbsoluteUrl("/auth/login/plugin", externalUrl);

    Issuer[custom.http_options] = function (opts) {
        opts = customizeUserAgent(opts);
        opts.timeout = options?.timeout || OKTA_DEFAULT_TIMEOUT;
        return opts;
    };

    console.log("Fetching Okta Authorization Server OpenId configuration...");

    const iss = await Issuer.discover(
        options.issuer +
            (options.issuer.substr(options.issuer.length - 1) === "/"
                ? ""
                : "/") +
            ".well-known/openid-configuration"
    );

    console.log(
        "Okta Authorization Server OpenId configuration:",
        iss.metadata
    );

    const client = new iss.Client({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uris: [getAbsoluteUrl("/okta/return", loginBaseUrl)]
    });

    console.log("Okta clientId: ", options.clientId);

    client[custom.http_options] = (options) => {
        options = customizeUserAgent(options);
        options.timeout = options.timeout || OKTA_DEFAULT_TIMEOUT;
        return options;
    };
    client[custom.clock_tolerance] =
        typeof options?.maxClockSkew === "undefined"
            ? OKTA_DEFAULT_MAX_CLOCK_SKEW
            : options.maxClockSkew;

    console.log("Timeout Setting: ", options.timeout || OKTA_DEFAULT_TIMEOUT);
    console.log("clock_tolerance Setting: ", client[custom.clock_tolerance]);
    console.log("OpenId Client Created!");

    return client;
}

/**
 * Determine redirect url based on req & authPluginRedirectUrl config.
 *
 * @param {express.Request} req
 * @param {string} authPluginRedirectUrl
 * @param {string} [externalUrl] optional; If provided, will attempt to convert the url into an absolute url.
 *  Otherwise, leave as it is.
 * @return {*}  {string}
 */
function determineRedirectUrl(
    req: express.Request,
    authPluginRedirectUrl: string,
    externalUrl?: string
): string {
    const resultRedirectionUrl = getAbsoluteUrl(
        authPluginRedirectUrl,
        externalUrl
    );

    return typeof req?.query?.redirect === "string" && req.query.redirect
        ? getAbsoluteUrl(req.query.redirect, externalUrl)
        : resultRedirectionUrl;
}

export default async function createAuthPluginRouter(
    options: AuthPluginRouterOptions
): Promise<Router> {
    const authorizationApi = options.authorizationApi;
    const passport = options.passport;
    const clientId = options.clientId;
    const clientSecret = options.clientSecret;
    const externalUrl = options.externalUrl;
    const sessionCookieOptions = options.sessionCookieOptions;
    const authPluginConfig = options.authPluginConfig;
    const scope = options.scope ? options.scope : DEFAULT_SCOPE;

    if (!clientId) {
        throw new Error("Required client id can't be empty!");
    }

    if (!clientSecret) {
        throw new Error("Required client secret can't be empty!");
    }

    if (!options.issuer || typeof options.issuer !== "string") {
        throw new Error(
            "Required issuer url (options.issuer) can't be empty and must be a string!"
        );
    }

    console.log("scope settings: ", scope);

    const client = await createOpenIdClient(options);

    const oidcStrategy = new OpenIdClientStrategy(
        {
            params: {
                scope
            },
            client
        },
        async (
            tokenSet: TokenSet,
            profile: any,
            done: (err: any, user?: any) => void
        ) => {
            if (!profile?.email) {
                return done(
                    new Error(
                        "Cannot locate email address from the user profile."
                    )
                );
            }

            const userData: passport.Profile = {
                id: profile?.sub,
                provider: authPluginConfig.key,
                displayName: profile?.name,
                name: {
                    familyName: profile?.family_name,
                    givenName: profile?.given_name
                },
                emails: [{ value: profile.email }]
            };

            try {
                const userToken = await createOrGetUserToken(
                    authorizationApi,
                    userData,
                    authPluginConfig.key
                );

                const authPluginData: any = {
                    key: authPluginConfig.key,
                    tokenSet
                };

                if (authPluginConfig.explicitLogout) {
                    // when `explicitLogout` = true (default value), set `logoutUrl` so the gateway will forward logout request to authPlugin
                    authPluginData.logoutUrl = `/auth/plugin/${authPluginConfig.key}/logout`;
                }

                done(null, {
                    ...userToken,
                    authPlugin: authPluginData
                });
            } catch (error) {
                done(error);
            }
        }
    );

    passport.use(STRATEGY_NAME, oidcStrategy);

    const router: express.Router = express.Router();

    router.get("/", (req, res, next) => {
        const opts: any = {
            scope,
            state: determineRedirectUrl(
                req,
                options.authPluginRedirectUrl,
                externalUrl
            )
        };
        passport.authenticate(STRATEGY_NAME, opts)(req, res, next);
    });

    router.get(
        "/return",
        (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            passport.authenticate(STRATEGY_NAME, {
                failWithError: true
            })(req, res, next);
        },
        (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            redirectOnSuccess(req.query.state as string, req, res);
        },
        (
            err: any,
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ): any => {
            redirectOnError(err, req.query.state as string, req, res);
        }
    );

    router.get(
        "/logout",
        async (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            const tokenSet = (req?.user as any)?.authPlugin?.tokenSet;
            // no matter what, attempt to destroy magda session first
            // this function is safe to call even when session doesn't exist
            await destroyMagdaSession(req, res, sessionCookieOptions);
            if (!tokenSet) {
                // can't find tokenSet from session
                // likely already signed off
                // redirect user agent back
                res.redirect(
                    determineRedirectUrl(
                        req,
                        options.authPluginRedirectUrl,
                        externalUrl
                    )
                );
            } else {
                // notify idP
                const redirectUrl = determineRedirectUrl(
                    req,
                    options.authPluginRedirectUrl
                );

                res.redirect(
                    client.endSessionUrl({
                        id_token_hint: tokenSet,
                        post_logout_redirect_uri: getAbsoluteUrl(
                            `/auth/plugin/${authPluginConfig.key}/logout/return`,
                            externalUrl,
                            {
                                redirect: redirectUrl
                            }
                        )
                    })
                );
            }
        }
    );

    router.get(
        "/logout/return",
        async (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            if (req?.user) {
                await destroyMagdaSession(req, res, sessionCookieOptions);
            }
            res.redirect(
                determineRedirectUrl(
                    req,
                    options.authPluginRedirectUrl,
                    externalUrl
                )
            );
        }
    );

    return router;
}
