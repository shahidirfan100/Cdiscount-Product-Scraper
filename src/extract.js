const CDISCOUNT_ORIGIN = 'https://www.cdiscount.com';

export function collectOffers(lplrData, includeSponsored) {
    const merged = [];
    const seen = new Set();

    const add = (offer, sponsored) => {
        if (!offer || typeof offer !== 'object') return;

        const isSponsored = Boolean(sponsored || offer.isSponsorised || offer.sponsoredCampaignId);
        if (!includeSponsored && isSponsored) return;

        const key = String(
            offer.id || offer.prices?.offerId || offer.productId || offer.url || `${offer.name || ''}-${merged.length}`,
        );
        if (seen.has(key)) return;

        seen.add(key);
        merged.push(sponsored && !offer.isSponsorised ? { ...offer, isSponsorised: true } : offer);
    };

    for (const offer of lplrData.offers || []) add(offer, false);

    if (includeSponsored) {
        for (const campaign of lplrData.sponsoredBrand?.campaigns || []) {
            for (const offer of campaign.offers || []) {
                add(offer, true);
            }
        }
    }

    return merged;
}

export function mapOfferToRecord(offer, lplrData, page, index, fetchedAt) {
    const normalizedMedia = dedupeMedia(
        Array.isArray(offer.media) ? offer.media.map(normalizeMedia).filter(Boolean) : [],
    );
    const firstMedia = normalizedMedia[0] || {};

    const record = {
        fetchedAt,
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
        averageOverallRating: offer.rating?.rate ?? offer.averageOverallRating,
        ratingCount: offer.rating?.reviewsCount ?? offer.totalRatingCount,
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
        isSponsored: Boolean(offer.isSponsorised || offer.sponsoredCampaignId),
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

export function toAbsoluteUrl(url) {
    if (!url || typeof url !== 'string') return undefined;

    try {
        const parsed = new URL(url, CDISCOUNT_ORIGIN);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
        return parsed.toString();
    } catch {
        return undefined;
    }
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
        .map((point) =>
            removeNullish({
                label: point?.displayName,
                value: point?.value,
                displayType: point?.displayType,
            }),
        )
        .filter(Boolean);
}

function normalizeCommercialOperations(operations) {
    if (!Array.isArray(operations)) return undefined;

    return operations
        .map((operation) =>
            removeNullish({
                operationGuid: operation?.operationGuid,
                operationType: operation?.operationType,
                labelName: operation?.labelName,
                labelType: operation?.labelType,
                name: operation?.name,
                endDate: operation?.endDate,
                price: operation?.priceDetail?.price,
                initialPrice: operation?.priceDetail?.initialPrice,
            }),
        )
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
