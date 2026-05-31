import crypto from "node:crypto";

import {verifyPassword} from "./password.js";

const COOKIE_NAME = "co2_auth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const ALLOW_INSECURE_AUTH = process.env.AUTH_ALLOW_INSECURE === "1";
const TRUST_PROXY = process.env.AUTH_TRUST_PROXY === "1";

function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
    return Buffer.from(value, "base64url").toString();
}

function sign(value, secret) {
    return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualString(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function getClientKey(req) {
    const forwardedFor = TRUST_PROXY ? req.headers["x-forwarded-for"] : null;
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }

    return req.socket?.remoteAddress || "unknown";
}

function isSecureRequest(req) {
    return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function isLocalRequest(req) {
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    const remoteAddress = req.socket?.remoteAddress;
    return ["localhost", "127.0.0.1", "::1"].includes(host)
        || remoteAddress === "127.0.0.1"
        || remoteAddress === "::1"
        || remoteAddress === "::ffff:127.0.0.1";
}

function canAcceptPassword(req) {
    return isSecureRequest(req) || isLocalRequest(req) || ALLOW_INSECURE_AUTH;
}

function parseCookies(header = "") {
    return Object.fromEntries(
        header
            .split(";")
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const index = part.indexOf("=");
                if (index === -1) return [part, ""];
                return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
            })
    );
}

function getCookieOptions(req) {
    const secure = isSecureRequest(req);
    return [
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
        secure ? "Secure" : "",
    ].filter(Boolean).join("; ");
}

function createSessionCookie(login, secret) {
    const payload = base64UrlEncode(JSON.stringify({
        login,
        exp: Date.now() + SESSION_TTL_MS,
    }));
    return `${payload}.${sign(payload, secret)}`;
}

function setSessionCookie(req, res, login, secret) {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${createSessionCookie(login, secret)}; ${getCookieOptions(req)}`);
}

function readSessionCookie(req, secret) {
    const cookie = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!cookie) return null;

    const [payload, signature] = cookie.split(".");
    if (!payload || !signature || !timingSafeEqualString(signature, sign(payload, secret))) {
        return null;
    }

    try {
        const session = JSON.parse(base64UrlDecode(payload));
        if (!session.login || !session.exp || Date.now() > session.exp) return null;
        return session;
    } catch {
        return null;
    }
}

function isAuthEnabled(user) {
    return Boolean(user?.login && user?.hash);
}

export function createAuth({user, secret = process.env.AUTH_SECRET || user?.hash}) {
    const enabled = isAuthEnabled(user);
    const loginAttempts = new Map();

    function isRateLimited(req) {
        const key = getClientKey(req);
        const now = Date.now();
        const record = loginAttempts.get(key);

        if (!record || now - record.startedAt > LOGIN_WINDOW_MS) {
            loginAttempts.set(key, {count: 1, startedAt: now});
            return false;
        }

        record.count += 1;
        return record.count > LOGIN_MAX_ATTEMPTS;
    }

    function clearRateLimit(req) {
        loginAttempts.delete(getClientKey(req));
    }

    function isAuthenticated(req) {
        if (!enabled) return true;
        const session = readSessionCookie(req, secret);
        return session?.login === user.login;
    }

    function getAuthenticatedSession(req) {
        if (!enabled) return null;
        const session = readSessionCookie(req, secret);
        if (session?.login !== user.login) return null;
        return session;
    }

    function renewSessionIfNeeded(req, res, session) {
        if (!session || session.exp - Date.now() > SESSION_RENEW_THRESHOLD_MS) return;
        setSessionCookie(req, res, user.login, secret);
    }

    function requireAuth(req, res, next) {
        if (!enabled) {
            next();
            return;
        }

        const session = getAuthenticatedSession(req);
        if (!session) {
            res.status(401).json({authenticated: false, error: "Unauthorized"}).end();
            return;
        }

        renewSessionIfNeeded(req, res, session);
        next();
    }

    function getStatus(req, res) {
        if (!enabled) {
            res.status(200).json({enabled: false, authenticated: true}).end();
            return;
        }

        const session = getAuthenticatedSession(req);
        if (session) {
            renewSessionIfNeeded(req, res, session);
        }

        res.status(session ? 200 : 401)
            .json({enabled: true, authenticated: Boolean(session)})
            .end();
    }

    async function login(req, res) {
        if (!enabled) {
            res.status(200).json({enabled: false, authenticated: true}).end();
            return;
        }

        if (!canAcceptPassword(req)) {
            res.status(403).json({authenticated: false, error: "HTTPS is required for login"}).end();
            return;
        }

        const {login: loginValue, password} = req.body || {};

        if (isRateLimited(req)) {
            res.status(429).json({authenticated: false, error: "Too many login attempts"}).end();
            return;
        }

        const passwordMatches = await verifyPassword(password, user.hash);
        if (loginValue !== user.login || !passwordMatches) {
            res.status(401).json({authenticated: false, error: "Invalid login or password"}).end();
            return;
        }

        clearRateLimit(req);
        setSessionCookie(req, res, user.login, secret);
        res.status(200).json({enabled: true, authenticated: true}).end();
    }

    return {
        enabled,
        getStatus,
        login,
        requireAuth,
    };
}
