import vm from 'node:vm';
import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const DEFAULT_START_URL = 'https://www.cdiscount.com/search/10/chair.html';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl,
        keyword,
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 10,
        includeSponsored = true,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(Number(resultsWantedRaw)) ? Math.max(1, Number(resultsWantedRaw)) : 20;
    const maxPages = Number.isFinite(Number(maxPagesRaw)) ? Math.max(1, Number(maxPagesRaw)) : 10;
    const initialUrl = buildInitialSearchUrl(startUrl, keyword);

    const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    const session = {
        cookieHeader: '',
        proxyUrl,
        userAgent: DEFAULT_USER_AGENT,
    };

    const seen = new Set();
    let totalSaved = 0;
    let page = 1;
    let totalPages = Number.MAX_SAFE_INTEGER;

    while (totalSaved < resultsWanted && page <= maxPages && page <= totalPages) {
        const pageUrl = buildPageUrl(initialUrl, page);
        const html = await fetchProtectedHtml(pageUrl, session);
        const lplrData = extractLplrData(html);

        if (!lplrData) {
            log.warning(`No LPLR data found on ${pageUrl}. Stopping.`);
            break;
        }

        totalPages = Number.isFinite(Number(lplrData.totalPageCount)) ? Number(lplrData.totalPageCount) : totalPages;
        const offers = collectOffers(lplrData, includeSponsored);

        if (!offers.length) {
            log.info(`No offers found on page ${page}. Stopping.`);
            break;
        }

        const batch = [];

        for (let index = 0; index < offers.length; index++) {
            if (totalSaved + batch.length >= resultsWanted) break;

            const offer = offers[index];
            const record = mapOfferToRecord(offer, lplrData, page, index);
            const uniqueKey = String(record.offerId || record.productId || record.productUrl || `${page}-${index}`);

            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            batch.push(record);
        }

        if (batch.length > 0) {
            await Dataset.pushData(batch);
            totalSaved += batch.length;
        }

        log.info(`Processed page ${page}/${Math.min(totalPages, maxPages)}. Saved ${batch.length} items (total: ${totalSaved}/${resultsWanted}).`);
        page++;
    }

    log.info(`Finished. Saved ${totalSaved} items.`);
} finally {
    await Actor.exit();
}

function buildInitialSearchUrl(startUrl, keyword) {
    if (startUrl && typeof startUrl === 'string') return startUrl;
    const sanitizedKeyword = String(keyword || '').trim().replace(/\s+/g, '+');
    return sanitizedKeyword ? `https://www.cdiscount.com/search/10/${encodeURIComponent(sanitizedKeyword).replace(/%2B/g, '+')}.html` : DEFAULT_START_URL;
}

function buildPageUrl(url, page) {
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page));
    return parsed.toString();
}

function getBaseHeaders(userAgent, cookieHeader) {
    const headers = {
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'user-agent': userAgent,
        'referer': 'https://www.cdiscount.com/',
    };
    if (cookieHeader) headers.cookie = cookieHeader;
    return headers;
}

async function fetchProtectedHtml(url, session) {
    if (!session.cookieHeader) {
        session.cookieHeader = await getChallengeCookie(url, session);
    }

    let response = await gotScraping({
        url,
        proxyUrl: session.proxyUrl,
        headers: getBaseHeaders(session.userAgent, session.cookieHeader),
        timeout: { request: 60000 },
        retry: { limit: 2 },
    });

    if (isChallengePage(response.body)) {
        log.warning(`Challenge detected for ${url}. Refreshing challenge cookie.`);
        session.cookieHeader = extractChallengeCookie(response.body) || await getChallengeCookie(url, session);
        response = await gotScraping({
            url,
            proxyUrl: session.proxyUrl,
            headers: getBaseHeaders(session.userAgent, session.cookieHeader),
            timeout: { request: 60000 },
            retry: { limit: 2 },
        });
    }

    if (isChallengePage(response.body)) {
        throw new Error(`Cdiscount challenge could not be solved for ${url}`);
    }

    return response.body;
}

async function getChallengeCookie(url, session) {
    const response = await gotScraping({
        url,
        proxyUrl: session.proxyUrl,
        headers: getBaseHeaders(session.userAgent, ''),
        timeout: { request: 60000 },
        retry: { limit: 2 },
    });

    const cookie = extractChallengeCookie(response.body);
    if (!cookie) throw new Error('Challenge cookie not found in Cdiscount response.');
    return cookie;
}

function extractChallengeCookie(body) {
    const nameMatch = body.match(/"name":"([^"]+)"/);
    const valueMatch = body.match(/"value":"([^"]+)"/);
    if (!nameMatch || !valueMatch) return '';
    return `${nameMatch[1]}=${valueMatch[1]}`;
}

function isChallengePage(html) {
    return html.includes('__blnChallengeStore') && html.includes('challengejs');
}

function extractLplrData(html) {
    const scriptMatch = html.match(/<script>\s*LPLR_PRELOADED_STATE\s*=\s*JSON\.parse\([\s\S]*?<\/script>/);
    if (!scriptMatch) return null;

    const scriptContent = scriptMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
    const sandbox = { JSON, LPLR_PRELOADED_STATE: undefined };
    vm.createContext(sandbox);
    vm.runInContext(scriptContent, sandbox, { timeout: 5000 });

    const state = sandbox.LPLR_PRELOADED_STATE;
    return state?.reactQueryState?.queries?.find((query) => query?.queryKey?.[0] === 'getLplr')?.state?.data || null;
}

function collectOffers(lplrData, includeSponsored) {
    const merged = [];
    const seen = new Set();

    const add = (offer) => {
        if (!offer || typeof offer !== 'object') return;
        if (!includeSponsored && offer.isSponsorised) return;
        const key = String(offer.id || offer.productId || offer.url || `${offer.name || ''}-${merged.length}`);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(offer);
    };

    for (const offer of lplrData.offers || []) add(offer);

    if (includeSponsored) {
        for (const campaign of lplrData.sponsoredBrand?.campaigns || []) {
            for (const offer of campaign.offers || []) add({ ...offer, isSponsorised: true, sponsoredCampaignId: campaign.campaignId });
        }
    }

    return merged;
}

function mapOfferToRecord(offer, lplrData, page, index) {
    const normalizedMedia = Array.isArray(offer.media) ? offer.media.map(normalizeMedia).filter(Boolean) : [];
    const firstMedia = normalizedMedia[0] || {};

    const record = {
        fetchedAt: new Date().toISOString(),
        searchWord: lplrData.searchWord,
        totalResultCount: lplrData.resultCount,
        currentPage: lplrData.currentPage,
        totalPages: lplrData.totalPageCount,
        page,
        rankOnPage: index + 1,
        offerId: offer.id ?? offer.prices?.offerId,
        productId: offer.productId,
        productName: offer.name,
        productUrl: toAbsoluteUrl(offer.url),
        imageUrl: firstMedia.src || firstMedia.thumbnailUrl,
        imageAlt: firstMedia.alt,
        price: offer.prices?.price?.value,
        priceWithoutVat: offer.prices?.price?.valueWithoutVAT,
        strikedPrice: offer.prices?.strikedPrice?.value,
        currency: 'EUR',
        averageOverallRating: offer.averageOverallRating,
        ratingCount: offer.totalRatingCount,
        brandId: offer.brandId,
        categoryId: offer.categoryId,
        categoryCodePath: offer.categoryCodePath,
        departmentId: offer.departmentId,
        minQuantity: offer.minQuantity,
        productCondition: offer.productCondition,
        sellerId: offer.sellerId ?? offer.seller?.sellerId,
        sellerName: offer.sellerName ?? offer.seller?.name,
        sellerCountry: offer.seller?.expeditionCountry,
        sellerSalesCount: offer.seller?.salesCount,
        isSponsored: Boolean(offer.isSponsorised),
        isCdav: offer.isCdav,
        isDownloadable: offer.isDownloadable,
        isFbc: offer.isFbc,
        isLgan: offer.isLgan,
        isMainPriceWithVariance: offer.isMainPriceWithVariance,
        bulletPoints: normalizeBulletPoints(offer.bulletPoints),
        commercialOperations: normalizeCommercialOperations(offer.commercialOperations),
        media: normalizedMedia,
    };

    return removeNullish(record);
}

function toAbsoluteUrl(url) {
    if (!url || typeof url !== 'string') return undefined;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://www.cdiscount.com${url}`;
    return url;
}

function normalizeMedia(media) {
    if (!media || typeof media !== 'object') return undefined;
    return removeNullish({
        src: toAbsoluteUrl(media.src),
        alt: media.alt,
        width: media.width,
        height: media.height,
        thumbnailUrl: toAbsoluteUrl(media.thumbnail?.url),
    });
}

function normalizeBulletPoints(bulletPoints) {
    if (!Array.isArray(bulletPoints)) return undefined;
    return bulletPoints
        .map((point) => removeNullish({
            label: point?.displayName,
            value: point?.value,
            displayType: point?.displayType,
        }))
        .filter(Boolean);
}

function normalizeCommercialOperations(operations) {
    if (!Array.isArray(operations)) return undefined;
    return operations
        .map((operation) => removeNullish({
            operationGuid: operation?.operationGuid,
            operationType: operation?.operationType,
            labelName: operation?.labelName,
            labelType: operation?.labelType,
            name: operation?.name,
            endDate: operation?.endDate,
            price: operation?.priceDetail?.price,
            initialPrice: operation?.priceDetail?.initialPrice,
        }))
        .filter(Boolean);
}

function removeNullish(value) {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }

    if (Array.isArray(value)) {
        const cleaned = value.map(removeNullish).filter((item) => item !== undefined);
        return cleaned.length > 0 ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleaned = {};
        for (const [key, item] of Object.entries(value)) {
            const normalized = removeNullish(item);
            if (normalized !== undefined) cleaned[key] = normalized;
        }
        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }

    return value;
}
