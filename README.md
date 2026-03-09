# Cdiscount Product Scraper

Extract product listing data from Cdiscount search pages in a structured dataset. Collect pricing, seller, rating, media, and listing metadata at scale for market research, catalog monitoring, and price analysis. Built for fast recurring runs with configurable limits and clean output.

## Features

- **Search-based extraction** - Collect products directly from Cdiscount search result pages.
- **Pagination support** - Traverse multiple result pages until your requested limit is reached.
- **Rich product fields** - Capture product, seller, pricing, media, rating, and ranking details.
- **Clean output** - Automatically removes null and empty fields from dataset items.
- **Sponsored visibility** - Optionally include sponsored offers in results.

## Use Cases

### Price Monitoring
Track product prices and striked prices over time to detect changes and promotions. Build historical datasets for pricing intelligence.

### Catalog Research
Analyze which products appear for strategic search terms. Identify listing density, competition, and category composition.

### Seller Benchmarking
Compare seller presence, rating signals, and listing positions for target keywords. Monitor how seller visibility changes across runs.

### Product Discovery
Collect top results for niche keywords to discover new products, brands, and categories quickly.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.cdiscount.com/search/10/chair.html` | Cdiscount search URL to scrape. |
| `keyword` | String | No | `"chair"` | Keyword used to build a search URL if `startUrl` is empty. |
| `results_wanted` | Integer | No | `20` | Maximum number of products to collect. |
| `max_pages` | Integer | No | `10` | Maximum number of pages to process. |
| `includeSponsored` | Boolean | No | `true` | Include sponsored offers when available. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional proxy settings. |

---

## Output Data

Each dataset item can include:

| Field | Type | Description |
|-------|------|-------------|
| `offerId` | Integer | Unique offer identifier. |
| `productId` | String | Product identifier. |
| `productName` | String | Listing title. |
| `productUrl` | String | Product page URL. |
| `price` | Number | Current price. |
| `priceWithoutVat` | Number | Price value without VAT when available. |
| `strikedPrice` | Number | Reference or previous price. |
| `currency` | String | Currency code used for price values. |
| `averageOverallRating` | Number | Average customer rating. |
| `ratingCount` | Integer | Number of ratings. |
| `sellerId` | Integer | Seller identifier. |
| `sellerName` | String | Seller display name. |
| `sellerCountry` | String | Seller expedition country. |
| `brandId` | Integer | Brand identifier. |
| `categoryId` | Integer | Category identifier. |
| `categoryCodePath` | String | Category path code. |
| `departmentId` | Integer | Department identifier. |
| `imageUrl` | String | Main product image URL. |
| `page` | Integer | Search result page number. |
| `rankOnPage` | Integer | Position on page. |
| `searchWord` | String | Search term used on the page. |
| `isSponsored` | Boolean | Whether the offer is sponsored. |
| `isCdav` | Boolean | CDAV flag when available. |
| `commercialOperations` | Array | Promotion or campaign details when available. |
| `bulletPoints` | Array | Product highlight attributes. |
| `fetchedAt` | String | ISO timestamp of extraction. |

---

## Usage Examples

### Basic Search URL Extraction

```json
{
    "startUrl": "https://www.cdiscount.com/search/10/chair.html",
    "results_wanted": 20
}
```

### Keyword-driven Collection

```json
{
    "keyword": "desk lamp",
    "results_wanted": 50,
    "max_pages": 5
}
```

### Include Sponsored Offers

```json
{
    "startUrl": "https://www.cdiscount.com/search/10/chair.html",
    "results_wanted": 30,
    "includeSponsored": true
}
```

---

## Sample Output

```json
{
    "fetchedAt": "2026-03-09T12:34:56.000Z",
    "searchWord": "chair",
    "totalResultCount": 7352,
    "currentPage": 1,
    "totalPages": 101,
    "page": 1,
    "rankOnPage": 1,
    "offerId": 2832604773,
    "productId": "auc1692267482141",
    "productName": "Wahson Chaise Salle a Manger Lot de 2",
    "productUrl": "https://www.cdiscount.com/maison/fauteuil-pouf-poire/lot-de-2-chaises-de-salle-a-manger-en-velours-pied/f-117200302-auc1692267482141.html",
    "imageUrl": "https://www.cdiscount.com/pdt2/1/4/1/1/400x400/auc1692267482141/rw/lot-de-2-chaises-de-salle-a-manger-en-velours-pied.jpg",
    "price": 195.99,
    "strikedPrice": 239.99,
    "currency": "EUR",
    "averageOverallRating": 4.62,
    "ratingCount": 35,
    "sellerId": 159554,
    "sellerName": "GY Furniture",
    "sellerCountry": "ALLEMAGNE",
    "isSponsored": true,
    "isCdav": false
}
```

---

## Tips for Best Results

### Use Stable Search URLs

- Start from a clear Cdiscount search URL that already shows relevant products.
- Keep keyword intent narrow to reduce noisy listings.

### Tune Limits for Speed

- Start with `results_wanted: 20` for quick validation runs.
- Increase limits gradually for larger production exports.

### Manage Pagination

- Increase `max_pages` only when you need deeper coverage.
- Combine `max_pages` with `results_wanted` to control runtime.

### Capture Sponsored Insights

- Keep `includeSponsored` enabled when advertising visibility matters.
- Disable it if you only want standard organic listings.

### Proxy Reliability

- Use proxy settings when running at higher scale.
- Keep input consistent between scheduled runs for comparable trend data.

---

## Integrations

Connect your dataset with:

- **Google Sheets** - Build shareable tracking dashboards.
- **Airtable** - Organize product and seller snapshots over time.
- **Looker Studio** - Visualize pricing and rank trends.
- **BigQuery** - Run analytics across large historical datasets.
- **Zapier** - Trigger downstream workflows from new runs.
- **Make** - Automate multi-step reporting pipelines.

### Export Formats

- **JSON** - Flexible structured output for APIs and ETL.
- **CSV** - Spreadsheet-friendly analysis.
- **Excel** - Business reporting workflows.
- **XML** - Legacy integration support.

---

## Frequently Asked Questions

### How many products can I collect?
You can collect as many as available based on your `results_wanted` and `max_pages` settings.

### Does it support pagination?
Yes. The actor iterates search pages and stops when limits are reached.

### Why are some fields missing in certain items?
Some offers do not expose every attribute. Empty and null values are removed from output for cleaner datasets.

### Can I include sponsored products?
Yes. Set `includeSponsored` to `true`.

### Is this suitable for scheduled monitoring?
Yes. It is suitable for recurring runs with stable input and consistent limits.

---

## Support

For issues or feature requests, use Apify Console support channels.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection use cases. You are responsible for complying with Cdiscount terms, local laws, and applicable data usage requirements.
