# Native social acquisition reporting

The admin-only `/admin/acquisition` dashboard compares historical daily Instagram organic views, TikTok snapshot gains, new non-beta profiles, and `survey_responses.referral_source`. It does not claim to measure store installs or attribute a signup to a particular post. All dates use UTC. No Fivetran subscription is needed.

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

## Instagram setup — business-owned accounts

Joywise owns both the Daily Hanzi Meta app and the dailyhanzi.app Instagram account. Use an explicit **portfolio system user**, rather than onboarding the same portfolio as its own client with a hidden business-integration system user. Meta's Facebook Login for Business documentation requires separate app-owner/client portfolios for the latter flow.

1. Open https://business.facebook.com/settings/ and select Joywise. Under **Users → System users**, add a system user named `Daily Hanzi Analytics`. An employee system user with explicit asset assignments is sufficient; do not grant unrelated business assets.
2. Assign the Daily Hanzi app and the dailyhanzi.app Instagram account to it. Enable the app-management permission needed to generate a token and the Instagram insight/read tasks available for that asset.
3. Generate a system-user token for the **Daily Hanzi Meta app**, with `instagram_basic` and `instagram_manage_insights`. Token permissions depend on the app's granted access; do not request publishing/advertising permissions for this analytics integration.
4. Find the numeric Instagram account ID under **Accounts → Instagram accounts → dailyhanzi.app**.
5. On `/admin/acquisition`, enter the ID and token under **Connect business-owned Instagram**, then **Validate and connect Instagram**. Enter the token only into this password field, never into chat or a URL. The server introspects it with Meta, verifies its app ID/type/validity/scopes/expiry, checks the exact account and views-insights access, then encrypts it in the existing marketing connection table. Failed validation leaves existing saved connections intact. No additional migration or Vercel variables are required beyond the existing Meta app ID/secret and encryption key.
6. Click **Sync now**. Connections and snapshots use the existing collectors. When a token expires or is revoked, generate and validate a replacement through the same form.

Official references:
- https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business/
- https://developers.facebook.com/docs/business-management-apis/system-users
- https://developers.facebook.com/docs/graph-api/reference/debug_token/

## Instagram setup — Unified Login for separate client businesses

Use Meta's recommended **Instagram API with Unified Login**. The Acquisition page now provides **Connect / reconnect Instagram**, using Facebook Login for Business with a `config_id`, server-side authorization code exchange, a ten-minute Secure/HttpOnly/SameSite OAuth-state cookie, and discovery through `/me/assigned_instagram_accounts`. No Facebook Page is needed for this flow. `/me` is a business integration system user, not an Instagram account.

1. In Meta's Daily Hanzi app, select **Use cases → Manage messaging & content on Instagram → Customize → API setup with Unified login**. The app must belong to a business portfolio and use Facebook Login for Business.
2. Create/select an Instagram Login Compatible configuration. Include `instagram_basic` and `instagram_manage_insights`. Meta's Unified Login configuration also requires `instagram_manage_messages`; the dashboard does not read messages. Remove optional publishing/comment/advertising permissions and ad-account access if Meta allows, since this app only reads analytics. Inspect the configuration preview and requested permissions before authorizing.
3. Save this exact Redirect URL: `https://dailyhanzi.app/api/admin/instagram/callback`.
4. Set these **server-only Vercel Production environment variables** and redeploy:

   | Variable | Value |
   | --- | --- |
   | `INSTAGRAM_META_APP_ID` | Meta app ID from app settings, not a legacy Instagram app ID. |
   | `INSTAGRAM_META_APP_SECRET` | Meta app secret from app settings. |
   | `INSTAGRAM_LOGIN_CONFIG_ID` | ID of the Unified Login configuration. |
   | `INSTAGRAM_REDIRECT_URI` | `https://dailyhanzi.app/api/admin/instagram/callback` |
   | `SOCIAL_TOKEN_ENCRYPTION_KEY` | Random 32-byte base64 secret. Generate with `openssl rand -base64 32`. Keep it stable: changing it requires reconnecting accounts. |
   | `INSTAGRAM_GRAPH_VERSION` | Optional pinned version, defaults to `v27.0`. |

5. Apply `supabase/marketing/migrations/202611050002_instagram_unified_login.sql` to the dedicated marketing project. Connections are app-scoped, service-role-only, and AES-256-GCM encrypted with the app/account identity as authenticated data. The browser never receives tokens or the app secret.
6. As an admin, open Acquisition, click **Connect / reconnect Instagram**, sign in through Meta and explicitly select the professional account(s) to track. In Development mode use an app role/Instagram Tester; accept any tester invite in Instagram's Website permissions. Public onboarding requires the appropriate Advanced Access/App Review and Live mode.
7. The callback verifies state and admin authorization, exchanges the one-time code, discovers assigned accounts (including pagination), verifies insights access and stores encrypted credentials. Connected accounts appear in sync status. Click **Sync now**; collect on consecutive UTC days to calculate daily gains. Meta cancellation leaves existing connections intact. Errors never expose provider response bodies or tokens. Expired/revoked grants require reconnection; non-expiring tokens can still be revoked.

Existing manually configured Instagram entries in `SOCIAL_ACCOUNTS_JSON` remain supported. Connected accounts take precedence over manual entries with the same ID, preventing duplicate syncs. TikTok configuration is unchanged. The media collector continues to use `graph.facebook.com`, request `views` insights, classify Reels/carousels, and paginate without following arbitrary provider next URLs. It does not subscribe to messaging/comment webhooks because analytics collection is polled.

Official references:
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions

## TikTok setup

Create a TikTok developer app with Login Kit and Display API access. Authorize the owned account with `video.list` (and `user.info.basic` for account identification), exchange the authorization code for tokens, and use the returned `open_id` as accountId. App approval may be required. This first collector uses Display API, not TikTok Ads or the more extensive Accounts API. It collects public videos and cumulative view/like/comment/share counts, not daily historical insights, watch-time metrics, or photo-carousel performance.

Official references:
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query
- https://developers.tiktok.com/docs/en/oauth-user-access-token-management

## Historical daily Instagram organic views

The **Content views and signup activity** chart uses `/{instagram-account-id}/insights` with `metric=views`, `period=day`, `metric_type=total_value`, `breakdown=media_product_type`, and explicit disjoint UTC `since`/`until` windows. It sums POST, FEED, CAROUSEL_CONTAINER, CAROUSEL_ITEM, REEL/REELS and STORY and excludes AD. The breakdown must reconcile exactly to the same metric's total; missing, unknown, duplicated, invalid or non-reconciling categories are gaps. No Ads Manager impressions or other metric is subtracted. Multi-account dates require verified data for every connected Instagram account.

Apply `202611060002_instagram_account_days.sql` to marketing. The first sync backfills completed dates in the rolling 90-calendar-day window (up to 89 dates; today is excluded). Later syncs revisit missing/unverified/unavailable dates and the latest three completed dates for Meta's up-to-48-hour reporting delay. Empty API results are stored as unavailable, never fabricated zeros. The table and transactional upsert RPC are service-role-only. Account insight failures preserve prior history and surface in sync status, independently of post collection.

The graph now labels its bar **Instagram organic views** and shows date coverage. TikTok is explicitly unclassified until its paid/organic semantics are validated. Account views include stories and historical daily data; the post comparison table still uses post snapshots and cannot reconstruct per-post historical days.

Official references:
- https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights
- https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights

## Read the post comparison table correctly

The first sync establishes a baseline; it never treats lifetime views as views earned today. Each subsequent UTC date compares the latest snapshot against the previous UTC date. Repeated syncs update today's snapshot. A failed account does not publish partial media snapshots. Accounts commit independently, so inspect sync status and measured-day coverage before comparing totals.

Missing prior days, missing counters, and decreasing counters produce gaps. A multi-day increase is not reassigned to one day. New posts need a baseline too, so first-day views are not counted as gains. Deleted or inaccessible posts stop contributing. Totals cover only measured post intervals and may undercount. Snapshots show collection-time gains, not exact calendar-day provider insights; late reporting can shift gains between dates. Meta documents the media-level `views` metric as organic, while `total_views` includes paid promotion; Instagram snapshots request `views`. TikTok public video counters remain unclassified. Never subtract ad impressions from video views without validating compatible definitions.

The date range scopes signups by profile creation time, not survey completion time. The last 90 days are refreshed each sync so changed answers are reflected. Only four fixed category counts (Instagram, TikTok, Other, Unknown) are copied to marketing, along with daily signup totals, app ID, and collection timestamp. No individual IDs, emails, survey free text, or user rows are copied. Signup/referral data is not read from the app when viewing the dashboard: dashboard data comes entirely from marketing after authentication. Missing aggregate days appear as gaps, not zero, and coverage/freshness is shown. Signups are neither first installs nor first opens.

## Multiple apps

The marketing project can be shared by multiple app admin websites. Configure each with the same marketing URL/key and a distinct `MARKETING_APP_ID` plus its own app database credentials and social accounts. Social snapshots, sync history, and signup aggregates include `app_id`, and dashboard queries filter by it. TikTok refresh tokens and active sync leases are keyed globally by social account so a rotating token cannot be refreshed concurrently by two app syncs. Use one authoritative collector per shared social account. Rotating tokens remain in the marketing project.

This is an internal service-role integration, not a tenant access boundary: the server key can access all marketing apps. Do not distribute it to clients or untrusted app operators.

Next attribution layers: connect App Store Connect / Google Play acquisition reports; add distinct platform/account campaign links and store campaign parameters; instrument landing-page/store clicks and app first opens. Use these to distinguish directly attributed acquisition from content correlations.

## Local checks

`node --test tests/social-acquisition.test.cjs tests/instagram-auth.test.cjs tests/instagram-days.test.cjs` runs mocked provider and aggregation checks without contacting social platforms. `npx tsc --noEmit` validates the app types. Live API verification requires provider authorization and the database migration; local tests do not establish that a configured account has approved permissions.

## Instagram callback troubleshooting

The generated login URL explicitly includes `override_default_response_type=true` as required by Facebook Login for Business system-user configurations. A provider approval screen confirms Meta granted access, not that the app saved the connection. Success is confirmed only by a stored account and the dashboard connection result.

Apply `202611060001_instagram_connection_attempts.sql` to the marketing project. Connection attempts store a one-way hash of state, safe stage/status labels and sanitized messages; no tokens, authorization codes, raw state or provider response bodies are stored. The latest attempt appears in Acquisition and remains visible after a refresh. `awaiting_meta` means the start was recorded but a verified callback has not completed; error stages distinguish validation, code exchange, account discovery, insight permissions and database storage. OAuth error URLs remain visible until the next connection attempt instead of disappearing on mount. Provider errors include only numeric codes and subcodes to diagnose permissions without exposing secrets.
