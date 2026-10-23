import { Actor, log } from 'apify';

import { CdiscountSession, FatalError, randomBetween, sleep } from './client.js';
import { collectOffers, mapOfferToRecord } from './extract.js';

const CDISCOUNT_ORIGIN = 'https://www.cdiscount.com';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const MAX_ACCESSIBLE_PAGES = 200;
const MIN_PAGE_DELAY_MS = 350;
const MAX_PAGE_DELAY_MS = 900;

await Actor.init();

let exitCode = 0;

try {
    await run();
} catch (error) {
    exitCode = 1;
    log.exception(error, 'Cdiscount scrape failed');
}

await Actor.exit({ exitCode });

async function run() {
    const input = (await Actor.getInput()) || {};

    const startUrl = normalizeOptionalString(input.startUrl);
    const keyword = normalizeOptionalString(input.keyword);
    const resultsWanted = normalizePositiveInteger(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = normalizePositiveInteger(input.max_pages, DEFAULT_MAX_PAGES);
    const includeSponsored = input.includeSponsored !== false;

    const targetUrl = resolveTargetUrl({ startUrl, keyword });
    const proxyConfiguration = await createProxyConfiguration(input.proxyConfiguration);
    const session = new CdiscountSession({ proxyConfiguration });

    log.info(
        `Start | url=${targetUrl} | results_wanted=${resultsWanted} | max_pages=${maxPages} | include_sponsored=${includeSponsored}`,
    );

    await session.init();

    const firstPage = await session.fetchSearchPage(buildPageUrl(targetUrl, 1), { required: true });
    const firstData = firstPage.data;
    const reportedTotalPages = normalizePositiveInteger(firstData.totalPageCount, maxPages);
    const lastPage = Math.min(maxPages, reportedTotalPages, MAX_ACCESSIBLE_PAGES);

    const seen = new Set();
    let totalSaved = 0;
    let pagesProcessed = 0;
    let emptyPages = 0;
    let stopReason = 'max_pages_reached';

    for (let page = 1; page <= lastPage; page += 1) {
        if (totalSaved >= resultsWanted) {
            stopReason = 'results_wanted_reached';
            break;
        }

        let result = firstPage;

        if (page > 1) {
            await sleep(randomBetween(MIN_PAGE_DELAY_MS, MAX_PAGE_DELAY_MS));
            result = await session.fetchSearchPage(buildPageUrl(targetUrl, page), { required: false });

            if (!result) {
                stopReason = `page_${page}_unavailable`;
                break;
            }
        }

        const pageData = result.data;
        const offers = collectOffers(pageData, includeSponsored);
        const fetchedAt = new Date().toISOString();
        const batch = [];

        for (let index = 0; index < offers.length; index += 1) {
            if (totalSaved + batch.length >= resultsWanted) break;

            const record = mapOfferToRecord(offers[index], pageData, page, index, fetchedAt);
            const uniqueKey = String(record.offerId || record.productId || record.productUrl || `${page}-${index}`);

            if (seen.has(uniqueKey)) continue;

            seen.add(uniqueKey);
            batch.push(record);
        }

        pagesProcessed += 1;

        if (batch.length > 0) {
            await Actor.pushData(batch);
            totalSaved += batch.length;
            emptyPages = 0;
        } else {
            emptyPages += 1;
        }

        log.info(`Page ${page}/${lastPage} | saved ${batch.length} | total ${totalSaved}/${resultsWanted}`);

        if (totalSaved >= resultsWanted) {
            stopReason = 'results_wanted_reached';
            break;
        }

        if (emptyPages >= 2) {
            stopReason = 'no_new_offers';
            break;
        }

        if (page >= lastPage) {
            stopReason = 'last_page_reached';
        }
    }

    if (totalSaved === 0) {
        throw new Error(`No products were found for ${targetUrl}`);
    }

    await Actor.setStatusMessage(`Saved ${totalSaved} products from ${pagesProcessed} page(s)`);
    log.info(`Done | saved=${totalSaved} | pages=${pagesProcessed} | stop_reason=${stopReason}`);
}

function resolveTargetUrl({ startUrl, keyword }) {
    if (startUrl) return normalizeStartUrl(startUrl);
    if (keyword) return buildKeywordUrl(keyword);

    throw new Error('Provide a Cdiscount startUrl or a keyword.');
}

function normalizeStartUrl(value) {
    let parsed;

    try {
        parsed = new URL(value);
    } catch {
        throw new FatalError(`Invalid startUrl: ${value}`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new FatalError('startUrl must use http or https.');
    }

    if (parsed.username || parsed.password) {
        throw new FatalError('startUrl must not contain credentials.');
    }

    if (!/^(?:[a-z0-9-]+\.)*cdiscount\.com$/i.test(parsed.hostname)) {
        throw new FatalError('startUrl must point to a cdiscount.com domain.');
    }

    parsed.protocol = 'https:';
    parsed.hash = '';

    return parsed.toString();
}

function buildKeywordUrl(keyword) {
    const encodedKeyword = encodeURIComponent(keyword.trim()).replace(/%20/g, '+');
    return `${CDISCOUNT_ORIGIN}/search/10/${encodedKeyword}.html`;
}

function buildPageUrl(url, page) {
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page));
    return parsed.toString();
}

async function createProxyConfiguration(rawProxyConfiguration) {
    if (!rawProxyConfiguration || typeof rawProxyConfiguration !== 'object') return undefined;

    const hasCustomProxies =
        Array.isArray(rawProxyConfiguration.proxyUrls) && rawProxyConfiguration.proxyUrls.length > 0;

    if (!rawProxyConfiguration.useApifyProxy && !hasCustomProxies) return undefined;

    return Actor.createProxyConfiguration(rawProxyConfiguration);
}

function normalizeOptionalString(value) {
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;

    return Math.max(1, Math.floor(parsed));
}
