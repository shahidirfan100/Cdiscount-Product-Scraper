## Selected API

- Endpoint: Browser-resolved `window.LPLR_PRELOADED_STATE` / `getLplr` query data embedded in Cdiscount search pages (`https://www.cdiscount.com/search/10/<keyword>.html?page=<n>`).
- Method: `GET` in a real Firefox browser session, then read the hydrated JSON directly from the page context.
- Auth: No login required, but the site is challenge-protected and does not reliably return the payload to plain HTTP clients even with rotating headers and residential proxies.
- Pagination: `?page=<n>` query parameter in the search URL.
- Fields available: Rich offer-level data including `id`, `productId`, `name`, `url`, `prices`, `seller`, `media`, `commercialOperations`, `ratings`, `category`, `department`, sponsored campaign data, and page-level metadata (`currentPage`, `totalPageCount`, `resultCount`, `searchWord`).
- Fields currently missing in actor: N/A (rewritten actor now extracts rich offer + page metadata and removes null/empty fields).
- Field count: 30+ practical fields at output level, with additional nested fields available through optional `includeRawOffer`.

## Notes

- Live browser inspection showed `window.LPLR_PRELOADED_STATE` is present after page load and contains the `getLplr` dataset with product results.
- Browser resource/XHR inspection did not expose a clean public search endpoint that could be replayed safely with `gotScraping`; the page data is already hydrated in-browser.
- Direct HTML requests frequently return the Baleen challenge instead of the result payload, so the HTTP-only approach was rejected.
- The chosen implementation is Playwright Firefox fallback: load the protected page, wait for hydrated state, extract `getLplr`, then paginate via search URLs.
