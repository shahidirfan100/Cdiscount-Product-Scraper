import { log } from 'apify';
import { load } from 'cheerio';
import { Impit } from 'impit';

const CDISCOUNT_ORIGIN = 'https://www.cdiscount.com';
const CHALLENGE_PATH = '/.well-known/baleen/challengejs/check';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 4;
const DEFAULT_CHALLENGE_MAX_AGE_SECONDS = 900;

const BROWSER_PROFILES = [
    'chrome',
    'chrome151',
    'chrome142',
    'chrome136',
    'firefox144',
    'firefox135',
    'chrome131',
    'chrome124',
];

export class RetryableError extends Error {}

export class ChallengeError extends RetryableError {}

export class FatalError extends Error {}

class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    absorb(headers) {
        let values = [];

        if (typeof headers.getSetCookie === 'function') {
            values = headers.getSetCookie();
        } else {
            const combined = headers.get('set-cookie');
            if (combined) values = [combined];
        }

        for (const value of values) {
            this.addFromSetCookie(value);
        }
    }

    addFromSetCookie(rawCookie) {
        if (!rawCookie || typeof rawCookie !== 'string') return;

        const [pair, ...attributes] = rawCookie.split(';');
        const separator = pair.indexOf('=');
        if (separator <= 0) return;

        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (!name) return;

        let maxAge;
        for (const attribute of attributes) {
            const attributeSeparator = attribute.indexOf('=');
            if (attributeSeparator === -1) continue;

            const key = attribute.slice(0, attributeSeparator).trim().toLowerCase();
            if (key !== 'max-age') continue;

            const parsed = Number(attribute.slice(attributeSeparator + 1).trim());
            if (Number.isFinite(parsed)) maxAge = parsed;
        }

        if (maxAge !== undefined && maxAge <= 0) {
            this.cookies.delete(name);
            return;
        }

        this.set(name, value, maxAge);
    }

    set(name, value, maxAgeSeconds) {
        const expires = maxAgeSeconds ? Date.now() + maxAgeSeconds * 1000 : undefined;

        this.cookies.set(name, { value, expires });
    }

    header() {
        const parts = [];

        for (const [name, cookie] of this.cookies) {
            if (cookie.expires && cookie.expires <= Date.now()) continue;
            parts.push(`${name}=${cookie.value}`);
        }

        return parts.length > 0 ? parts.join('; ') : undefined;
    }
}

export class CdiscountSession {
    constructor({ proxyConfiguration } = {}) {
        this.proxyConfiguration = proxyConfiguration;
        this.profileCursor = Math.floor(Math.random() * BROWSER_PROFILES.length);
        this.healCount = 0;
        this.client = null;
        this.jar = null;
        this.profile = null;
        this.proxyUrl = null;
    }

    async init() {
        await this.heal('initial');
    }

    async heal(reason) {
        this.healCount += 1;

        const profile = BROWSER_PROFILES[this.profileCursor % BROWSER_PROFILES.length];
        this.profileCursor += 1;

        let proxyUrl;
        if (this.proxyConfiguration) {
            const sessionId = `cdiscount_${Date.now()}_${this.healCount}_${Math.random().toString(36).slice(2, 8)}`;

            try {
                proxyUrl = await this.proxyConfiguration.newUrl(sessionId);
            } catch (error) {
                throw new FatalError(`Proxy session could not be created: ${error.message}`);
            }
        }

        this.jar = new CookieJar();
        this.profile = profile;
        this.proxyUrl = proxyUrl;
        this.client = new Impit({
            browser: profile,
            http3: false,
            timeout: REQUEST_TIMEOUT_MS,
            ...(proxyUrl ? { proxyUrl } : {}),
        });

        if (reason !== 'initial') {
            log.warning(
                `HTTP session renewed after ${reason}; browser profile ${profile}${proxyUrl ? ', proxy session rotated' : ''}`,
            );
        }
    }

    async request(url, { method = 'GET', headers = {}, body } = {}) {
        const requestHeaders = { ...headers };
        const cookieHeader = [requestHeaders.cookie, this.jar.header()].filter(Boolean).join('; ');

        if (cookieHeader) requestHeaders.cookie = cookieHeader;

        const response = await this.client.fetch(url, {
            method,
            headers: requestHeaders,
            ...(body !== undefined ? { body } : {}),
        });

        this.jar.absorb(response.headers);
        return response;
    }

    async solveChallenge(html) {
        const store = extractChallengeStore(html);
        const cookieName = store?.cookie?.name;
        const cookieValue = store?.cookie?.value;

        if (!cookieName || !cookieValue) {
            throw new ChallengeError('Baleen challenge store did not contain a cookie');
        }

        const challengeUrl = new URL(CHALLENGE_PATH, CDISCOUNT_ORIGIN);
        challengeUrl.searchParams.set(cookieName, cookieValue);

        const payload = new URLSearchParams(
            store.checkChallengeParams || {
                rule_id: '',
                tracking_id: '',
                bot_category: 'unknown',
                request_fate: 'challengejs',
            },
        ).toString();

        const response = await this.request(challengeUrl.toString(), {
            method: 'POST',
            headers: {
                'content-type': 'text/plain;charset=UTF-8',
                cookie: `${cookieName}=${cookieValue}`,
            },
            body: payload,
        });

        await response.arrayBuffer();

        if (response.status >= 400) {
            throw new ChallengeError(`Baleen challenge check returned HTTP ${response.status}`);
        }

        const maxAge = Number(store.cookie.maxAge);
        this.jar.set(
            cookieName,
            cookieValue,
            Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_CHALLENGE_MAX_AGE_SECONDS,
        );
    }

    async fetchSearchPage(url, { required = false } = {}) {
        let lastError;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            try {
                let response = await this.request(url);
                let html = await readResponseText(response);

                if (html.includes('__blnChallengeStore')) {
                    await this.solveChallenge(html);
                    response = await this.request(url);
                    html = await readResponseText(response);
                }

                if (response.status === 429) {
                    const waitMs = getRetryAfterMs(response.headers);
                    if (attempt === MAX_ATTEMPTS) {
                        throw new RetryableError('Cdiscount rate limit persisted');
                    }

                    log.warning(`Cdiscount rate limit hit; waiting ${Math.round(waitMs / 1000)} seconds`);
                    await sleep(waitMs);

                    try {
                        await this.heal('rate limit');
                    } catch (healError) {
                        if (required) throw healError;
                        log.warning(`Stopping pagination: ${healError.message}`);
                        return null;
                    }

                    continue;
                }

                if (response.status >= 500) {
                    throw new RetryableError(`Cdiscount returned HTTP ${response.status}`);
                }

                if (response.status === 400 || response.status === 404) {
                    throw new FatalError(`Cdiscount returned HTTP ${response.status} for ${url}`);
                }

                if (response.status === 403 || isBlockedPage(html)) {
                    throw new ChallengeError('Cdiscount blocked the request');
                }

                const data = extractLplrData(html);
                if (data) {
                    return { data, html, finalUrl: response.url, source: 'lplr' };
                }

                const domData = extractDomData(html, url);
                if (domData) {
                    log.warning('LPLR state was missing; extracted products from the HTML fallback');
                    return { data: domData, html, finalUrl: response.url, source: 'dom' };
                }

                throw new ChallengeError('Cdiscount response contained no product data');
            } catch (error) {
                lastError = error;

                if (error instanceof FatalError) {
                    if (required) throw error;
                    log.warning(`Skipping ${url}: ${error.message}`);
                    return null;
                }

                if (attempt === MAX_ATTEMPTS) break;

                if (error instanceof ChallengeError) {
                    try {
                        await this.heal(error.message);
                    } catch (healError) {
                        if (required) throw healError;
                        log.warning(`Stopping pagination: ${healError.message}`);
                        return null;
                    }

                    await sleep(randomBetween(500, 1100));
                } else {
                    log.warning(`Request retry ${attempt}/${MAX_ATTEMPTS} after ${error.message}`);
                    await sleep(Math.min(8000, 800 * 2 ** (attempt - 1)) + randomBetween(0, 400));

                    try {
                        await this.heal('retryable request error');
                    } catch (healError) {
                        if (required) throw healError;
                        log.warning(`Stopping pagination: ${healError.message}`);
                        return null;
                    }
                }
            }
        }

        if (required) throw lastError;

        log.warning(`Skipping ${url}: ${lastError?.message || 'request failed'}`);
        return null;
    }
}

async function readResponseText(response) {
    const buffer = await response.arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
}

function extractChallengeStore(html) {
    const markerIndex = html.indexOf('__blnChallengeStore');
    if (markerIndex === -1) return null;

    const start = html.indexOf('{', markerIndex);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < html.length; index += 1) {
        const character = html[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(start, index + 1));
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
}

export function extractLplrData(html) {
    const literal = extractLplrLiteral(html);
    if (!literal) return null;

    let state;
    try {
        state = JSON.parse(JSON.parse(literal));
    } catch {
        return null;
    }

    const queries = state?.reactQueryState?.queries;
    if (!Array.isArray(queries)) return null;

    const query = queries.find((entry) => entry?.queryKey?.[0] === 'getLplr' && entry?.state?.data);
    const data = query?.state?.data;

    if (data && Array.isArray(data.offers)) return data;

    const fallback = queries.map((entry) => entry?.state?.data).find((entry) => entry && Array.isArray(entry.offers));

    return fallback || null;
}

function extractLplrLiteral(html) {
    const marker = 'LPLR_PRELOADED_STATE';
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) return null;

    const parseIndex = html.indexOf('JSON.parse(', markerIndex);
    if (parseIndex === -1) return null;

    const start = html.indexOf('"', parseIndex);
    if (start === -1) return null;

    let escaped = false;
    for (let index = start + 1; index < html.length; index += 1) {
        const character = html[index];

        if (escaped) {
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (character === '"') {
            return html.slice(start, index + 1);
        }
    }

    return null;
}

export function extractDomData(html, pageUrl) {
    let $;
    try {
        $ = load(html);
    } catch {
        return null;
    }

    const cards = $('article[data-e2e="offer-item"]');
    if (cards.length === 0) return null;

    const offers = [];

    cards.each((index, element) => {
        const card = $(element);
        const link =
            firstAttribute(card, ['a[href*="idOffre="]', 'a[href*="/f-"]', 'a[href]'], 'href') ||
            card.closest('a[href]').attr('href');

        const title = firstText(card, ['[data-e2e="lplr-title"]', 'h2', '[data-e2e*="title"]']);

        const priceText = firstText(card, ['[data-e2e="lplr-price"]', '[data-e2e*="price"]']);

        const image = card.find('img[data-e2e="lplr-image"], img').first();
        const imageUrl =
            image.attr('src') ||
            image.attr('data-src') ||
            image.attr('data-original') ||
            firstSrcsetUrl(image.attr('srcset'));

        const productId = image.attr('data-product-id') || extractProductIdFromUrl(link) || undefined;

        const offerId = extractOfferIdFromUrl(link);

        if (!link && !title) return;

        offers.push({
            id: offerId,
            productId,
            name: title,
            url: link,
            prices: priceText ? { price: { value: parsePrice(priceText) } } : undefined,
            media: imageUrl ? [{ src: imageUrl, alt: image.attr('alt') || title }] : undefined,
            sellerName: firstText(card, ['[data-e2e*="seller"]']),
            isSponsorised: card.find('[data-e2e*="sponsor"]').length > 0 || /sponsoris/i.test(card.text()),
            position: index + 1,
        });
    });

    if (offers.length === 0) return null;

    return {
        offers,
        searchWord: extractSearchWordFromUrl(pageUrl),
        currentPage: extractPageFromUrl(pageUrl),
        totalPageCount: extractLastPageFromHtml($),
        resultCount: extractResultCount($),
        sponsoredBrand: null,
        source: 'dom',
    };
}

function firstAttribute(card, selectors, attribute) {
    for (const selector of selectors) {
        const element = card.find(selector).first();
        const value = element.attr(attribute);
        if (value) return value;
    }
    return undefined;
}

function firstText(card, selectors) {
    for (const selector of selectors) {
        const text = card.find(selector).first().text().trim();
        if (text) return text;
    }
    return undefined;
}

function firstSrcsetUrl(srcset) {
    if (!srcset) return undefined;
    const first = srcset.split(',')[0]?.trim();
    return first ? first.split(/\s+/)[0] : undefined;
}

function extractOfferIdFromUrl(url) {
    if (!url) return undefined;
    try {
        const parsed = new URL(url, CDISCOUNT_ORIGIN);
        const offerId = parsed.searchParams.get('idOffre');
        if (!offerId) return undefined;

        const numericOfferId = Number(offerId);
        return Number.isFinite(numericOfferId) ? numericOfferId : undefined;
    } catch {
        return undefined;
    }
}

function extractProductIdFromUrl(url) {
    if (!url) return undefined;
    const match = String(url).match(/\/f-\d+-([a-z0-9]+)\.html/i);
    return match?.[1];
}

function extractSearchWordFromUrl(url) {
    try {
        const parsed = new URL(url, CDISCOUNT_ORIGIN);
        const match = parsed.pathname.match(/\/search\/\d+\/(.+)\.html$/i);
        if (!match) return undefined;

        const value = match[1].replace(/\+/g, ' ');
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    } catch {
        return undefined;
    }
}

function extractPageFromUrl(url) {
    try {
        const parsed = new URL(url, CDISCOUNT_ORIGIN);
        const page = Number(parsed.searchParams.get('page'));
        return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
        return 1;
    }
}

function extractLastPageFromHtml($) {
    let lastPage = 0;

    $('a[href*="page="]').each((index, element) => {
        const href = $(element).attr('href');
        if (!href) return;

        try {
            const parsed = new URL(href, CDISCOUNT_ORIGIN);
            const page = Number(parsed.searchParams.get('page'));
            if (Number.isFinite(page) && page > lastPage) lastPage = page;
        } catch {
            // Ignore malformed pagination links.
        }
    });

    return lastPage || undefined;
}

function extractResultCount($) {
    const text = $('body').text();
    const match = text.match(/([\d\s.,]{1,15})\s+r[ée]sultats?/i);
    if (!match) return undefined;

    const value = Number(match[1].replace(/[^\d]/g, ''));
    return Number.isFinite(value) ? value : undefined;
}

function parsePrice(text) {
    const match = String(text).match(/(\d[\d\s.,]*)\s*€/);
    if (!match) return undefined;

    let raw = match[1].replace(/\s/g, '');
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');

    if (lastComma !== -1 && lastDot !== -1) {
        raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (lastComma !== -1) {
        raw = raw.replace(',', '.');
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function isBlockedPage(html) {
    return (
        /<title>\s*Acc[èe]s bloqu[ée]/i.test(html) ||
        /captcha-delivery|datadome|access denied|unauthorized access/i.test(html)
    );
}

function getRetryAfterMs(headers) {
    const raw = headers.get('retry-after');
    if (!raw) return 2000;

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
        return Math.min(30000, Math.max(1000, seconds * 1000));
    }

    const timestamp = Date.parse(raw);
    if (!Number.isNaN(timestamp)) {
        return Math.min(30000, Math.max(1000, timestamp - Date.now()));
    }

    return 2000;
}

export function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}
