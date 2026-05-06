import { Actor, log } from 'apify';
import { Dataset, PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

const DEFAULT_START_URL = 'https://www.cdiscount.com/search/10/chair.html';
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media', 'stylesheet']);
const BLOCKED_URL_PATTERNS = [
    'abtasty',
    'api-data-connector.abtasty.com',
    'cdn.trustcommander.net',
    'cdtm.cdiscount.com',
    'dcinfos-cache.abtasty.com',
    'dm-event.net',
    'google-analytics',
    'googletagmanager',
    'doubleclick',
    'facebook',
    'adsense',
    'cdn-cgi/rum',
];
const MAX_PARALLEL_PAGES = 4;

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
    const targetConcurrency = calculateTargetConcurrency(resultsWanted, maxPages);
    const crawlState = {
        seen: new Set(),
        enqueued: new Set(),
        completedPages: new Set(),
        highestScheduledPage: 1,
        totalSaved: 0,
        totalPages: Number.MAX_SAFE_INTEGER,
    };

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        launchContext: {
            launcher: firefox,
            launchOptions: {
                headless: true,
            },
            userAgent: getRandomUserAgent(),
        },
        maxConcurrency: targetConcurrency,
        maxRequestRetries: 1,
        navigationTimeoutSecs: 45,
        requestHandlerTimeoutSecs: 60,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 8,
            sessionOptions: {
                maxUsageCount: 20,
                maxErrorScore: 2,
            },
        },
        preNavigationHooks: [
            async ({ page, request }, gotoOptions) => {
                Object.assign(gotoOptions, {
                    waitUntil: 'domcontentloaded',
                    timeout: 90000,
                });

                await page.route('**/*', (route) => {
                    const resourceType = route.request().resourceType();
                    const resourceUrl = route.request().url();

                    if (BLOCKED_RESOURCE_TYPES.has(resourceType)
                        || BLOCKED_URL_PATTERNS.some((pattern) => resourceUrl.includes(pattern))) {
                        return route.abort();
                    }

                    return route.continue();
                });

                await page.setExtraHTTPHeaders({
                    'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
                    referer: 'https://www.cdiscount.com/',
                });

                await page.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                });

                log.info(`Navigating page ${request.userData.page || 1}: ${request.url}`);
            },
        ],
        requestHandler: async ({ page, request, session }) => {
            if (crawlState.totalSaved >= resultsWanted) return;

            const currentPage = request.userData.page || 1;

            const lplrData = await waitForLplrData(page);

            if (!lplrData) {
                const pageTitle = await page.title().catch(() => '');
                log.warning(`No LPLR data on page ${currentPage}. Title: ${pageTitle}`);
                session?.markBad();
                return;
            }

            crawlState.totalPages = Number.isFinite(Number(lplrData.totalPageCount))
                ? Number(lplrData.totalPageCount)
                : crawlState.totalPages;

            const offers = collectOffers(lplrData, includeSponsored);
            if (!offers.length) {
                log.info(`No offers found on page ${currentPage}. Stopping.`);
                return;
            }

            const batch = [];

            for (let index = 0; index < offers.length; index++) {
                if (crawlState.totalSaved + batch.length >= resultsWanted) break;

                const offer = offers[index];
                const record = mapOfferToRecord(offer, lplrData, currentPage, index);
                const uniqueKey = String(record.offerId || record.productId || record.productUrl || `${currentPage}-${index}`);

                if (crawlState.seen.has(uniqueKey)) continue;
                crawlState.seen.add(uniqueKey);
                batch.push(record);
            }

            if (batch.length > 0) {
                await Dataset.pushData(batch);
                crawlState.totalSaved += batch.length;
            }
            crawlState.completedPages.add(currentPage);

            log.info(`Processed page ${currentPage}/${Math.min(crawlState.totalPages, maxPages)}. Saved ${batch.length} items (total: ${crawlState.totalSaved}/${resultsWanted}).`);

            if (crawlState.totalSaved >= resultsWanted) return;

            if (currentPage === 1) {
                const firstPageYield = Math.max(1, batch.length);
                const estimatedPagesNeeded = Math.ceil(resultsWanted / firstPageYield);
                await enqueuePagesThrough({
                    crawler,
                    initialUrl,
                    crawlState,
                    endPage: Math.min(maxPages, crawlState.totalPages, estimatedPagesNeeded),
                });
            }

            const averagePageYield = Math.max(
                1,
                Math.floor(crawlState.totalSaved / crawlState.completedPages.size),
            );
            const estimatedTotalPagesNeeded = Math.ceil(resultsWanted / averagePageYield);
            const desiredHighestPage = Math.min(
                maxPages,
                crawlState.totalPages,
                estimatedTotalPagesNeeded,
            );

            await enqueuePagesThrough({
                crawler,
                initialUrl,
                crawlState,
                endPage: desiredHighestPage,
            });
        },
        failedRequestHandler: async ({ request }, error) => {
            log.error(`Failed request: ${request.url}`, { error: error.message });
        },
    });

    const firstUrl = buildPageUrl(initialUrl, 1);
    crawlState.enqueued.add(firstUrl);
    await crawler.run([{
        url: firstUrl,
        userData: { page: 1 },
    }]);

    log.info(`Finished. Saved ${crawlState.totalSaved} items.`);
} finally {
    await Actor.exit();
}

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function calculateTargetConcurrency(resultsWanted, maxPages) {
    if (resultsWanted <= 60) return 1;
    if (resultsWanted <= 120) return Math.min(2, maxPages, MAX_PARALLEL_PAGES);
    if (resultsWanted <= 240) return Math.min(3, maxPages, MAX_PARALLEL_PAGES);
    return Math.min(MAX_PARALLEL_PAGES, maxPages);
}

function buildInitialSearchUrl(startUrl, keyword) {
    if (startUrl && typeof startUrl === 'string') return startUrl;
    const sanitizedKeyword = String(keyword || '').trim().replace(/\s+/g, '+');
    return sanitizedKeyword
        ? `https://www.cdiscount.com/search/10/${encodeURIComponent(sanitizedKeyword).replace(/%2B/g, '+')}.html`
        : DEFAULT_START_URL;
}

function buildPageUrl(url, page) {
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page));
    return parsed.toString();
}

async function enqueuePagesThrough({ crawler, initialUrl, crawlState, endPage }) {
    if (endPage <= crawlState.highestScheduledPage) return;

    const requests = [];
    for (let pageNumber = crawlState.highestScheduledPage + 1; pageNumber <= endPage; pageNumber++) {
        const pageUrl = buildPageUrl(initialUrl, pageNumber);
        if (crawlState.enqueued.has(pageUrl)) continue;

        crawlState.enqueued.add(pageUrl);
        requests.push({
            url: pageUrl,
            userData: { page: pageNumber },
        });
    }

    if (requests.length === 0) return;

    const nextHighestScheduledPage = Math.max(crawlState.highestScheduledPage, endPage);
    Object.assign(crawlState, {
        highestScheduledPage: nextHighestScheduledPage,
    });
    await crawler.addRequests(requests);
}

async function waitForLplrData(page) {
    try {
        await page.waitForFunction(() => Boolean(
            window.LPLR_PRELOADED_STATE?.reactQueryState?.queries?.length,
        ), { timeout: 30000 });
    } catch {
        return null;
    }

    return page.evaluate(() => {
        const state = window.LPLR_PRELOADED_STATE;
        return state?.reactQueryState?.queries?.find((query) => query?.queryKey?.[0] === 'getLplr')?.state?.data
            || state?.reactQueryState?.queries?.[0]?.state?.data
            || null;
    });
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
            for (const offer of campaign.offers || []) add({
                ...offer,
                isSponsorised: true,
                sponsoredCampaignId: campaign.campaignId,
            });
        }
    }

    return merged;
}

function mapOfferToRecord(offer, lplrData, page, index) {
    const normalizedMedia = dedupeMedia(Array.isArray(offer.media) ? offer.media.map(normalizeMedia).filter(Boolean) : []);
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

function dedupeMedia(mediaItems) {
    const unique = [];
    const seen = new Set();

    for (const media of mediaItems) {
        if (!media) continue;
        const key = `${media.src || ''}|${media.thumbnailUrl || ''}|${media.alt || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(media);
    }

    return unique;
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
