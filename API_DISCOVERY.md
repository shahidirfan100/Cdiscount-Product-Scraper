## Selected API

- Endpoint: `LPLR_PRELOADED_STATE` JSON payload embedded in Cdiscount search HTML responses (`https://www.cdiscount.com/search/10/<keyword>.html?page=<n>`).
- Method: `GET` (page request), then parse preloaded JSON from HTML.
- Auth: No login required. Cdiscount anti-bot challenge cookie (`visit_baleen_*`) must be acquired and sent before extracting full content.
- Pagination: `?page=<n>` query parameter in the search URL.
- Fields available: Rich offer-level data including `id`, `productId`, `name`, `url`, `prices`, `seller`, `media`, `commercialOperations`, `ratings`, `category`, `department`, sponsored campaign data, and page-level metadata (`currentPage`, `totalPageCount`, `resultCount`, `searchWord`).
- Fields currently missing in actor: N/A (rewritten actor now extracts rich offer + page metadata and removes null/empty fields).
- Field count: 30+ practical fields at output level, with additional nested fields available through optional `includeRawOffer`.

## Notes

- URLScan historical scans for Cdiscount search pages were reviewed to identify modern search page architecture and confirm `SEARCH_AJAX` scene usage.
- Direct HTML without challenge cookie returns a lightweight challenge page; challenge cookie bootstrap is required before extraction.
