# Local BRE data source connectors

Five new sources are registered in the feed pipeline and the manual Pull Feeds dashboard. **They are not live until MEDC supplies verified source URLs.** Each source reports an explicit "not connected" error rather than claiming a successful empty scan.

Configure these Vercel environment variables (HTTPS endpoints returning a JSON array, or an object with a `data` array):

| Feed | Environment variable |
| --- | --- |
| McKinney building permits | `BREP_PERMITS_JSON_URL` |
| Job postings | `BREP_JOBS_JSON_URL` |
| Texas sales tax | `BREP_SALES_TAX_JSON_URL` |
| Collin County employment | `BREP_EMPLOYMENT_JSON_URL` |
| Property records | `BREP_PROPERTY_JSON_URL` |

Expected row fields: `company` or `company_name` or `business_name` or `employer_name`; `city` / `site_city` / `municipality`; stable `id`, `record_id`, `permit_number`, `case_number`, `parcel_id`, or `posting_id`; `date` / `issue_date` / `filed_date` / `posted_date`; and `description` / `title` / `activity`.

This generic adapter only accepts business-level records with a company name and either a tracked exact name or a McKinney city field. **Aggregate sales tax and employment datasets are not compatible with the company-level signal table** and must be integrated as separate city/county indicators before connecting those URLs. Do not fabricate a company name to force aggregate rows through the adapter.

These integrations need validation against the actual portal schema, pagination, authentication, license, and geographic coverage before production use. A public web page or CSV download is not a JSON endpoint. Each request has a 15-second timeout. No scraping, credentials, or source IDs have been invented.
