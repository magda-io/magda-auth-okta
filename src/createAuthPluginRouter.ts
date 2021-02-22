import express, { Router } from "express";
import { Authenticator } from "passport";
import { default as ApiClient } from "@magda/auth-api-client";
import {
    AuthPluginConfig,
    getAbsoluteUrl,
    redirectOnSuccess,
    redirectOnError
} from "@magda/authentication-plugin-sdk";
import OpenIdClient, {
    Issuer,
    custom,
    Strategy as OpenIdClientStrategy,
    TokenSet
} from "openid-client";
import os from "os";
const pkg = require("../package.json");

const OKTA_DEFAULT_TIMEOUT = 10000;
const OKTA_DEFAULT_MAX_CLOCK_SKEW = 120;
const STRATEGY_NAME = "okta-oidc";

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
    const externalUrl = options.externalUrl;
    const loginBaseUrl = `${externalUrl}/auth/login/plugin`;

    Issuer[custom.http_options] = function (opts) {
        opts = customizeUserAgent(opts);
        opts.timeout = options?.timeout || OKTA_DEFAULT_TIMEOUT;
        return opts;
    };

    const iss = await Issuer.discover(
        options.issuer + "/.well-known/openid-configuration"
    );

    const client = new iss.Client({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uris: [`${loginBaseUrl}/okta/return`]
    });
    client[custom.http_options] = (options) => {
        options = customizeUserAgent(options);
        options.timeout = options.timeout || OKTA_DEFAULT_TIMEOUT;
        return options;
    };
    client[custom.clock_tolerance] =
        typeof options?.maxClockSkew === "undefined"
            ? OKTA_DEFAULT_MAX_CLOCK_SKEW
            : options.maxClockSkew;

    return client;
}

export default async function createAuthPluginRouter(
    options: AuthPluginRouterOptions
): Promise<Router> {
    //const authorizationApi = options.authorizationApi;
    const passport = options.passport;
    const clientId = options.clientId;
    const clientSecret = options.clientSecret;
    const externalUrl = options.externalUrl;
    const resultRedirectionUrl = getAbsoluteUrl(
        options.authPluginRedirectUrl,
        externalUrl
    );

    if (!clientId) {
        throw new Error("Required client id can't be empty!");
    }

    if (!clientSecret) {
        throw new Error("Required client secret can't be empty!");
    }

    if (!options.issuer) {
        throw new Error("Required issuer url (options.issuer) can't be empty!");
    }

    const client = await createOpenIdClient(options);

    const oidcStrategy = new OpenIdClientStrategy(
        {
            params: {
                scope: options.scope
            },
            client
        },
        (tokenSet: TokenSet, callbackArg1: any, callbackArg2: any) => {
            let done: (err: any, user?: any) => void;
            let userinfo: any;

            if (typeof callbackArg2 !== "undefined") {
                done = callbackArg2;
                userinfo = callbackArg1;
            } else {
                done = callbackArg1;
            }

            if (tokenSet) {
                return userinfo
                    ? done(null, {
                          userinfo,
                          tokens: tokenSet
                      })
                    : done(null, {
                          tokens: tokenSet
                      });
            } else {
                return done(null);
            }
        }
    );

    passport.use(STRATEGY_NAME, oidcStrategy);

    const router: express.Router = express.Router();

    router.get("/", (req, res, next) => {
        const options: any = {
            scope: ["profile", "email"],
            state:
                typeof req?.query?.redirect === "string" && req.query.redirect
                    ? getAbsoluteUrl(req.query.redirect, externalUrl)
                    : resultRedirectionUrl
        };
        passport.authenticate(STRATEGY_NAME, options)(req, res, next);
    });

    router.get(
        "/return",
        (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            passport.authenticate("arcgis", {
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

    return router;
}
