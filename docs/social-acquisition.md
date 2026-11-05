# Native social acquisition reporting

The admin-only `/admin/acquisition` dashboard compares daily social view gains, new non-beta profiles, and `survey_responses.referral_source`. It does not claim to measure store installs or attribute a signup to a particular post. All dates use UTC. No Fivetran subscription is needed.

## Provisioned marketing project

- Organization: Joywise Ltd
- Project: `marketing-analytics`
- Project reference: `kykggtajlolpiobfmwfc`
- Region: Singapore (`ap-southeast-1`)
- Dashboard: https://supabase.com/dashboard/project/kykggtajlolpiobfmwfc
- Initial marketing migration has been applied to this project. Local `.env.local` uses this project; production hosting variables still need to be configured.

## Enable collection

1. Create a **dedicated marketing Supabase project**. Apply `supabase/marketing/migrations/202611050001_social_acquisition.sql` in that project's SQL editor. Do not apply this migration to Daily Hanzi's app project. No app database migration is required. Marketing tables have RLS enabled with no browser grants; reporting goes through an admin-checked server route.
2. Configure these server environment variables:

   | Variable | Project / purpose |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing Daily Hanzi app project: unchanged, used for admin authentication. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Existing app project's key: used only for read-only signup aggregation by this feature. |
   | `MARKETING_SUPABASE_URL` | New, separate marketing project URL. |
   | `MARKETING_SUPABASE_SERVICE_ROLE_KEY` | New marketing project's service-role key: social metrics, sync history, tokens, and signup aggregates. |
   | `MARKETING_APP_ID` | Stable app slug, e.g. `daily-hanzi`. Required, and used to scope dashboard reads and metric writes. |

   Never prefix marketing credentials with `NEXT_PUBLIC_`. There is no fallback to the app database: missing marketing configuration or a marketing URL with the same hostname as the app project fails with a setup error.
3. Set `SOCIAL_ACCOUNTS_JSON` to an array of owned accounts, for example:

```json
[
  {
    "platform": "instagram",
    "accountId": "YOUR_INSTAGRAM_PROFESSIONAL_ACCOUNT_ID",
    "label": "Daily Hanzi Instagram",
    "accessToken": "YOUR_META_ACCESS_TOKEN"
  },
  {
    "platform": "tiktok",
    "accountId": "YOUR_AUTHORIZED_TIKTOK_OPEN_ID",
    "label": "Daily Hanzi TikTok",
    "accessToken": "YOUR_INITIAL_TIKTOK_ACCESS_TOKEN",
    "refreshToken": "YOUR_INITIAL_TIKTOK_REFRESH_TOKEN"
  }
]
```

4. For TikTok automatic refresh, set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. The initial refresh token seeds collection. Subsequent rotated refresh tokens are persisted in the service-role-only `social_tiktok_tokens` table; this table contains secrets and must not be exposed through browser APIs. An account sync lease prevents concurrent token refreshes. To replace authorization, remove its saved token in this table and update the server secrets with the new authorization. Without a refresh token, manually replace the access token before it expires (TikTok documents a 24-hour lifetime).
5. Open Acquisition as an admin and click **Sync now**. Verify each account reports success. This performs read-only social API calls and writes reporting snapshots to the marketing project. The same sync reads the app's last 90 UTC days of non-beta signups, computes daily counts, and transactionally upserts aggregates in marketing. A successful run includes zero-signup days; failed reads preserve prior aggregates. Signup sync also works with `SOCIAL_ACCOUNTS_JSON=[]`, before social accounts are authorized.
6. Configure an external scheduler to call `GET /api/cron/social-sync` with `Authorization: Bearer <CRON_SECRET>`. Set a long random `CRON_SECRET` on the server. Run once daily at a consistent UTC time, e.g. `5 0 * * *`. No schedule is automatically installed. The route allows up to 300 seconds; hosting must support that duration. For large libraries, move collection to a background worker before enabling more accounts. A timed-out running account becomes eligible for retry after 15 minutes.

## Instagram setup

Use **Instagram API with Facebook Login**, a professional Instagram account linked to a Facebook Page, and a token authorized for that account. Configure a Meta developer app and obtain the relevant permissions (`instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, plus discovery permissions such as `pages_show_list` as needed). App review/access requirements depend on account and app ownership. Use the Instagram account ID, not the Page ID. Token acquisition is performed in the provider's developer tools; this version does not provide an in-app OAuth connect flow or automatic Meta token renewal. Monitor expiry and rotate the server token.

The collector requests `/{ig-user-id}/media` and `/{media-id}/insights?metric=views`, paginates the entire media library, and classifies `CAROUSEL_ALBUM` as Carousel and `media_product_type=REELS` as Reel. Insights may be unavailable for some older media; an API rejection fails the account with a visible error rather than publishing a partial baseline. Stories and carousel-slide-level analytics are not collected. `INSTAGRAM_GRAPH_VERSION` defaults to `v26.0`; pin a supported version for your Meta app and validate metrics against real authorized media.

Official references:
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights/

## TikTok setup

Create a TikTok developer app with Login Kit and Display API access. Authorize the owned account with `video.list` (and `user.info.basic` for account identification), exchange the authorization code for tokens, and use the returned `open_id` as accountId. App approval may be required. This first collector uses Display API, not TikTok Ads or the more extensive Accounts API. It collects public videos and cumulative view/like/comment/share counts, not daily historical insights, watch-time metrics, or photo-carousel performance.

Official references:
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query
- https://developers.tiktok.com/docs/en/oauth-user-access-token-management

## Read the dashboard correctly

The first sync establishes a baseline; it never treats lifetime views as views earned today. Each subsequent UTC date compares the latest snapshot against the previous UTC date. Repeated syncs update today's snapshot. A failed account does not publish partial media snapshots. Accounts commit independently, so inspect sync status and measured-day coverage before comparing totals.

Missing prior days, missing counters, and decreasing counters produce gaps. A multi-day increase is not reassigned to one day. New posts need a baseline too, so first-day views are not counted as gains. Deleted or inaccessible posts stop contributing. Totals cover only measured post intervals and may undercount. Snapshots show collection-time gains, not exact calendar-day provider insights; late reporting can shift gains between dates. Paid and organic distribution are not separated, so totals are labelled provider views rather than verified organic views. Never subtract ad impressions from video views without validating compatible definitions.

The date range scopes signups by profile creation time, not survey completion time. The last 90 days are refreshed each sync so changed answers are reflected. Only four fixed category counts (Instagram, TikTok, Other, Unknown) are copied to marketing, along with daily signup totals, app ID, and collection timestamp. No individual IDs, emails, survey free text, or user rows are copied. Signup/referral data is not read from the app when viewing the dashboard: dashboard data comes entirely from marketing after authentication. Missing aggregate days appear as gaps, not zero, and coverage/freshness is shown. Signups are neither first installs nor first opens.

## Multiple apps

The marketing project can be shared by multiple app admin websites. Configure each with the same marketing URL/key and a distinct `MARKETING_APP_ID` plus its own app database credentials and social accounts. Social snapshots, sync history, and signup aggregates include `app_id`, and dashboard queries filter by it. TikTok refresh tokens and active sync leases are keyed globally by social account so a rotating token cannot be refreshed concurrently by two app syncs. Use one authoritative collector per shared social account. Rotating tokens remain in the marketing project.

This is an internal service-role integration, not a tenant access boundary: the server key can access all marketing apps. Do not distribute it to clients or untrusted app operators.

Next attribution layers: connect App Store Connect / Google Play acquisition reports; add distinct platform/account campaign links and store campaign parameters; instrument landing-page/store clicks and app first opens. Use these to distinguish directly attributed acquisition from content correlations.

## Local checks

`node --test tests/social-acquisition.test.cjs` runs mocked provider and aggregation checks without contacting social platforms. `npx tsc --noEmit` validates the app types. Live API verification requires provider authorization and the database migration; local tests do not establish that a configured account has approved permissions.
