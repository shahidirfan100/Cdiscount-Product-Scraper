# Cdiscount discovery notes

## Selected data source

- Page: `https://www.cdiscount.com/search/10/<keyword>.html?page=<n>`
- Transport: HTTP `GET` with `impit` browser impersonation. No browser process is used.
- Data path: `LPLR_PRELOADED_STATE` embedded in the search HTML, then `reactQueryState.queries` entry with `queryKey[0] === 'getLplr'`, then `state.data`.
- Authentication: none. The site uses the Baleen/Octolia challenge instead of a login.
- Pagination: `page` query parameter. `currentPage`, `totalPageCount`, and `resultCount` come from the hydrated state.

The hydrate payload is a JavaScript string containing JSON:

```js
LPLR_PRELOADED_STATE = JSON.parse('{"reactQueryState":...}');
```

The extractor locates the string literal, parses it twice, then reads the `getLplr` query. Page-level fields include `searchWord`, `currentPage`, `totalPageCount`, `resultCount`, `offers`, `sponsoredBrand`, `facets`, and `suggestions`.

## Baleen challenge

A fresh HTTP client receives a ~14 KB challenge page containing `window.__blnChallengeStore`. The store includes:

- `cookie.name` and `cookie.value` (for example `visit_baleen_ACM-...`)
- `cookie.maxAge` (900 seconds)
- `checkChallengeParams` (rule ID, tracking ID, bot category, request fate)

The flow is:

1. Request the search URL and detect `__blnChallengeStore`.
2. `POST https://www.cdiscount.com/.well-known/baleen/challengejs/check?<cookieName>=<cookieValue>` with `content-type: text/plain;charset=UTF-8` and the challenge cookie.
3. Send `checkChallengeParams` as the form body.
4. Re-request the search URL with the challenge cookie. The response is the full SSR page: about 0.9 to 1.1 MB and 61 to 64 organic offers for page 1.

The actor performs this flow on demand, so an expired 15-minute cookie is replaced automatically.

## Transport findings

`impit` 0.14.7 with any of these profiles solved the challenge and returned the full page:

- `chrome`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`, `chrome124`, `chrome125`, `chrome131`, `chrome136`, `chrome142`, `chrome151`
- `firefox`, `firefox128`, `firefox133`, `firefox135`, `firefox144`
- `ios18` (mobile SSR, larger payload)

`okhttp`, `okhttp3`, `okhttp4`, and `okhttp5` received a captcha page directly and are not used.

Playwright headless Chrome was blocked. Headed Chrome worked but was only used during discovery; the production actor is HTTP-only.

## BFF API status

`bffmobilesite.cdiscount.com` exposes a mobile site API, but its search endpoint is not usable for this actor:

- `POST /search?context=search` returned HTTP 403 Baleen "Unauthorized access" with every tested cookie and header combination.
- `GET /search` without `context` returned HTTP 400 JSON.
- `POST /search?context=SEARCH` passed the edge but the application returned HTTP 400 "Context SEARCH is not available".
- `GET /search/suggestions?query=...` worked, but it does not provide product listings.

The SSR page plus `LPLR_PRELOADED_STATE` is therefore the reliable data source.

## Limits and fallbacks

- Cdiscount reports `totalPageCount = 101` for broad terms such as `chair`, but deep pages around 100 return the block page. The actor stops pagination when a later page cannot be recovered and keeps the products already saved.
- A product-detail URL does not contain `getLplr`; the actor is intentionally a search-listing scraper.
- The HTML fallback reads `article[data-e2e="offer-item"]` cards, `[data-e2e="lplr-title"]`, `[data-e2e="lplr-price"]`, and `[data-e2e="lplr-image"]` when the hydrate state is missing.
- JSON-LD contains only one aggregate product object, not one entry per offer, so it is not used for listing extraction.
