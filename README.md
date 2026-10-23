## What does Cdiscount Product Scraper do?

Cdiscount Product Scraper collects structured offer data from Cdiscount search result pages. Provide a Cdiscount search URL or a keyword, choose how many products and pages to collect, and receive product, price, seller, rating, image, promotion, and search-position data in an Apify dataset.

Use it for ecommerce market research, catalog discovery, price analysis, seller benchmarking, and repeatable product snapshots. Each dataset item represents one offer found in the Cdiscount search results available during the run.

The Actor uses HTTP requests with browser impersonation. It handles Cdiscount's session challenge automatically, renews its session when a request is blocked, rotates browser profiles, and reads the search page's hydrated product state. If that state is unavailable, it falls back to extracting the visible product cards from the HTML.

## Why use Cdiscount Product Scraper?

- **Product research** - Find products, brands, categories, and sellers for a specific Cdiscount search term.
- **Price analysis** - Compare current prices, prices without VAT when available, and reference prices across search results.
- **Search visibility tracking** - Record the result page and position for each offer so you can compare rankings between runs.
- **Seller benchmarking** - Collect seller names, seller identifiers, seller country, and sales-count signals when Cdiscount publishes them.
- **Sponsored offer analysis** - Include sponsored offers when they are available on the search page, or exclude them for an organic-results dataset.
- **Clean dataset output** - Null, blank, and empty nested values are omitted from each saved item.

## Output Data

The Actor extracts offer-level data from Cdiscount search listings. Each item represents one offer. Availability varies by offer because Cdiscount does not publish every field for every product.

| Field                     | Type    | Description                                                                            |
| ------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `offerId`                 | Number  | Unique offer identifier when available.                                                |
| `productId`               | String  | Cdiscount product identifier.                                                          |
| `productName`             | String  | Product or listing title.                                                              |
| `productUrl`              | String  | Absolute URL to the product page.                                                      |
| `price`                   | Number  | Current product price.                                                                 |
| `priceWithoutVat`         | Number  | Current price without VAT when available.                                              |
| `strikedPrice`            | Number  | Reference or previous price when available.                                            |
| `currency`                | String  | Currency code used by the Actor, currently `EUR`.                                      |
| `averageOverallRating`    | Number  | Average customer rating when available.                                                |
| `ratingCount`             | Number  | Number of ratings when available.                                                      |
| `sellerId`                | Number  | Seller identifier when available.                                                      |
| `sellerName`              | String  | Seller display name.                                                                   |
| `sellerCountry`           | String  | Seller expedition country.                                                             |
| `sellerSalesCount`        | Number  | Seller sales-count signal when available.                                              |
| `brandId`                 | Number  | Brand identifier when available.                                                       |
| `categoryId`              | Number  | Category identifier when available.                                                    |
| `categoryCodePath`        | String  | Cdiscount category path value when available.                                          |
| `departmentId`            | Number  | Department identifier when available.                                                  |
| `productCondition`        | String  | Product condition when available.                                                      |
| `minQuantity`             | Number  | Minimum purchase quantity when available.                                              |
| `imageUrl`                | String  | Main product image URL.                                                                |
| `imageAlt`                | String  | Main image alternative text when available.                                            |
| `media`                   | Array   | Available media objects with image URLs, alternative text, dimensions, and thumbnails. |
| `bulletPoints`            | Array   | Product highlight objects with labels, values, and display types.                      |
| `commercialOperations`    | Array   | Promotion or campaign objects with labels, dates, and price details when available.    |
| `isSponsored`             | Boolean | Whether the offer is marked as sponsored.                                              |
| `isCdav`                  | Boolean | CDAV indicator when available.                                                         |
| `isDownloadable`          | Boolean | Downloadable-product indicator when available.                                         |
| `isFbc`                   | Boolean | FBC indicator when available.                                                          |
| `isLgan`                  | Boolean | LGAN indicator when available.                                                         |
| `isMainPriceWithVariance` | Boolean | Whether the displayed main price has a variance.                                       |
| `searchWord`              | String  | Search term reported by Cdiscount.                                                     |
| `totalResultCount`        | Number  | Total result count reported for the search page.                                       |
| `currentPage`             | Number  | Page number reported by Cdiscount.                                                     |
| `totalPages`              | Number  | Total search pages reported by Cdiscount.                                              |
| `page`                    | Number  | Page processed by the Actor.                                                           |
| `rankOnPage`              | Number  | Offer position within the processed page.                                              |
| `fetchedAt`               | String  | ISO timestamp for when the item was collected.                                         |

## How to scrape Cdiscount product data

1. Open Cdiscount Product Scraper in Apify.
2. Enter a public Cdiscount search URL, or enter a keyword to create one automatically.
3. Set `results_wanted` and `max_pages` for the size of the collection.
4. Choose whether to include sponsored offers.
5. Run the Actor and review the dataset preview.
6. Export the results or connect the dataset to your next workflow.

When both `startUrl` and `keyword` are provided, the Actor uses `startUrl` and ignores `keyword` completely. This matters because `keyword` has a runtime default. If you clear `keyword` and leave `startUrl` empty, the run fails with a clear validation error.

## Input Parameters

| Parameter            | Type    | Required | Default                      | Description                                                                                                     |
| -------------------- | ------- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `startUrl`           | String  | No       | Not set                      | Full Cdiscount search URL to process. It takes priority over `keyword` when both are provided.                  |
| `keyword`            | String  | No       | `chair`                      | Search term used to build a Cdiscount search URL when `startUrl` is empty. Ignored when `startUrl` is supplied. |
| `results_wanted`     | Integer | No       | `20`                         | Maximum number of unique products to save. Minimum accepted value is `1`.                                       |
| `max_pages`          | Integer | No       | `10`                         | Maximum number of search pages to process. Minimum accepted value is `1`.                                       |
| `includeSponsored`   | Boolean | No       | `true`                       | Include sponsored brand offers when Cdiscount makes them available.                                             |
| `proxyConfiguration` | Object  | No       | `{ "useApifyProxy": false }` | Optional Apify Proxy configuration.                                                                             |

The Actor accepts one `startUrl` string or one `keyword` string. It does not accept a `startUrls` array or separate price, category, seller, stock, or rating filter fields. To use those search constraints, provide a Cdiscount search URL that already contains the desired search context.

## Usage Examples

### Basic search URL extraction

Collect up to 20 product offers from a Cdiscount chair search page:

```json
{
    "startUrl": "https://www.cdiscount.com/search/10/chair.html",
    "results_wanted": 20
}
```

### Keyword-based product collection

Let the Actor build the Cdiscount search URL from a keyword and process up to five pages:

```json
{
    "keyword": "desk lamp",
    "results_wanted": 50,
    "max_pages": 5
}
```

### Exclude sponsored offers

Collect a larger search snapshot while excluding sponsored offers when the source marks them:

```json
{
    "startUrl": "https://www.cdiscount.com/search/10/office-chair.html",
    "results_wanted": 100,
    "max_pages": 8,
    "includeSponsored": false,
    "proxyConfiguration": {
        "useApifyProxy": true
    }
}
```

## Sample Output

The following is one representative dataset item. Optional fields are omitted when Cdiscount does not provide them for an offer.

```json
{
    "fetchedAt": "2026-10-23T11:03:50.819Z",
    "searchWord": "chair",
    "totalResultCount": 19021,
    "currentPage": 1,
    "totalPages": 101,
    "page": 1,
    "rankOnPage": 8,
    "offerId": 2710301248,
    "productId": "auc1687246353402",
    "productName": "Wahson Lot de 2 Chaise Salle à Manger en Velours Moderne avec Pieds en métal, Rembourrées pour Cuisine et Restaurant,Gris",
    "productUrl": "https://www.cdiscount.com/maison/fauteuil-pouf-poire/wahson-lot-de-2-chaise-salle-a-manger-en-velours-m/f-117200302-auc1687246353402.html",
    "imageUrl": "https://www.cdiscount.com/pdt2/4/0/2/1/300x300/auc1687246353402/rw/wahson-lot-de-2-chaise-salle-a-manger-en-velours-m.jpg",
    "imageAlt": "Wahson Lot de 2 Chaise Salle à Manger en Velours Moderne avec Pieds en métal, Rembourrées pour Cuisine et Restaurant,Gris",
    "price": 149.99,
    "priceWithoutVat": 124.99,
    "strikedPrice": 189.99,
    "currency": "EUR",
    "averageOverallRating": 4.6,
    "ratingCount": 38,
    "sellerId": 159554,
    "sellerName": "GY Furniture",
    "isSponsored": true,
    "isCdav": false,
    "media": [
        {
            "src": "https://www.cdiscount.com/pdt2/4/0/2/1/300x300/auc1687246353402/rw/wahson-lot-de-2-chaise-salle-a-manger-en-velours-m.jpg",
            "alt": "Wahson Lot de 2 Chaise Salle à Manger en Velours Moderne avec Pieds en métal, Rembourrées pour Cuisine et Restaurant,Gris",
            "width": 300,
            "height": 300
        }
    ]
}
```

## Data-quality behavior and limitations

- Each offer is deduplicated using its offer ID, product ID, or product URL when available.
- The Actor recursively removes null values, blank strings, empty arrays, and empty objects before saving an item.
- The final dataset can contain fewer items than `results_wanted` when the page limit is reached, the source reports fewer results, duplicate offers are found, two consecutive pages add no new offers, or a page cannot provide the expected result data.
- Pagination is limited by both `max_pages` and Cdiscount's reported number of result pages. The Actor can stop earlier after reaching `results_wanted`.
- Blocked, rate-limited, or challenged requests are retried with a fresh session. A deep page that remains unavailable stops pagination without discarding products already saved. A failure on the first page, or a search that yields no products, fails the run so empty output is not reported as success.
- Sponsored offers are included only when `includeSponsored` is `true` and sponsored offers are present on the source page.
- Search-page fields are source-dependent. Prices, ratings, seller details, promotional data, media, and flags may be absent for individual offers.
- This Actor is designed for Cdiscount search result pages and listing data. It does not provide a separate product-detail crawl mode or a separate review extraction mode.
- There are no dedicated input fields for price ranges, brands, sellers, availability, or categories. Use a Cdiscount search URL that reflects the search you want to analyze.
- Cdiscount search pages can change over time. Validate a small run before relying on a field for a long-term monitoring workflow.

## Tips for Best Results

- Use a complete public Cdiscount search URL when you need a specific locale, category, or search context.
- Use focused keywords instead of broad terms to reduce unrelated listings.
- Start with `results_wanted: 20` and a small `max_pages` value to verify the dataset before increasing the collection size.
- Keep `results_wanted` and `max_pages` aligned. A high result target with a low page limit may return fewer products than requested.
- Leave `includeSponsored` enabled when sponsored visibility matters. Set it to `false` when you want to focus on offers that are not marked as sponsored.
- Treat optional output fields as nullable in downstream workflows, because not every Cdiscount offer exposes the same information.
- For price or ranking monitoring, keep the search URL and input limits consistent across scheduled runs.

## Integrations and export formats

Use the dataset with ecommerce data workflows:

- **Apify API** - Read dataset items programmatically after a run.
- **Google Sheets** - Export product records for sorting, filtering, and price comparisons.
- **Airtable** - Store product and seller snapshots in a searchable catalog.
- **Webhooks** - Trigger a downstream workflow after a run completes.
- **Make and Zapier** - Connect Cdiscount results to no-code automations.
- **JSON, CSV, Excel, and XML** - Download the dataset for applications, spreadsheets, reporting, or imports.

## Frequently Asked Questions

### Can I scrape Cdiscount with only a keyword?

Yes. Provide `keyword` and leave `startUrl` empty. The Actor builds a Cdiscount search URL from the keyword.

### Can I provide a Cdiscount search URL instead?

Yes. Provide the full URL in `startUrl`. When both inputs are present, `startUrl` is used instead of `keyword`.

### How many products can I collect?

The Actor attempts to save up to `results_wanted` unique products, subject to `max_pages`, available source results, duplicate removal, and page data quality.

### Does the Actor support pagination?

Yes. It processes numbered Cdiscount search pages until it reaches the requested product count, the page limit, the source's last page, or two consecutive pages without new offers.

### Why are some fields missing?

Fields are missing when the individual Cdiscount offer does not publish them. The Actor also removes null, blank, and empty values to keep records concise.

### Can I include sponsored products?

Yes. `includeSponsored` defaults to `true`. Set it to `false` to exclude offers marked as sponsored when that information is available.

### Can I collect prices in currencies other than EUR?

No separate currency input is supported. The current output sets `currency` to `EUR` for Cdiscount price values.

### Can I schedule recurring Cdiscount snapshots?

Yes. Use Apify scheduling with consistent inputs to compare prices, ratings, sellers, pages, and ranks between runs. Source listings can change between runs.

### Is it legal to scrape Cdiscount?

You are responsible for complying with Cdiscount's terms, applicable laws, privacy requirements, and any restrictions on how collected data may be used. Use the Actor for legitimate data collection from publicly available pages.

## Related Actors

- [Namshi Product Scraper](https://apify.com/shahidirfan/namshi-product-scraper) - Collect product listings, prices, ratings, and seller signals from Namshi.
- [AliExpress Scraper](https://apify.com/shahidirfan/aliexpress-scraper) - Extract product, pricing, review, and seller data from AliExpress.
- [Trendyol Product Scraper](https://apify.com/shahidirfan/trendyol-product-scraper) - Collect structured product listings, prices, ratings, images, and marketplace data from Trendyol.

## Support

For issues or feature requests, use the Issues tab on the Actor page in Apify. Include the input JSON, the affected Cdiscount search URL, and a sample dataset item when reporting a reproducible issue.

## Legal Notice

This Actor is intended for legitimate data collection from publicly available Cdiscount pages. You are responsible for complying with Cdiscount's terms of service, applicable laws, privacy rules, and responsible data-use requirements.
