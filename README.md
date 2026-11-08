This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Google Play refunds

`/admin/refunds` lets admins and moderators search by exact user email or GPA order ID, view order value and confirmed refunds in the buyer's currency, and confirm a full refund with access revocation. No real refunds are issued during setup or checks.

Before use, apply `supabase/policies/play_refunds.sql` in this app's Supabase project and configure these server-only environment variables:

- `SUPABASE_SERVICE_ROLE_KEY`: this app's Supabase service role key.
- `GOOGLE_PLAY_PACKAGE_NAME`: the exact Android application ID from Play Console (Hanzi: `com.alexliu.dailyhanzi`; Hangul: `uk.co.joywise.dailyhangul`; verify Deutsch in Play Console).
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: the complete JSON service account credential, stored as a secret, never with a `NEXT_PUBLIC_` prefix.

Enable the Google Play Developer API in the service account's Cloud project. Invite its email to Play Console with access to this app and the permissions “View financial data, orders, and cancellation survey responses” and “Manage orders and subscriptions”. See https://developers.google.com/android-publisher/getting_started.

Email lookup uses `profiles.email` and `subscription_events.user_id`, `store = PLAY_STORE`, and `raw.transaction_id`. Only Google-confirmed amounts are displayed. Subscription refunds use `subscriptionsv2.revoke` with `fullRefund` and require the latest paid order; one-time purchases use `orders.refund?revoke=true`. Older subscription orders and partially refunded orders require manual handling in Play Console.

A unique audit record prevents concurrent or repeated attempts. An uncertain result remains locked as `needs_review`; check Play Console before manually reconciling any audit record. Refunds are never retried automatically. A Google success revokes the store purchase and sets the linked profile's `is_pro` to false and `pro_expires_at` to now. Ensure Google Play real-time developer notifications reach RevenueCat and the existing subscription webhook keeps app entitlements synchronized. Unlinked profiles or failed profile writes produce explicit reconciliation warnings; a successful payment request cannot be rolled back. Do not remove independent access grants when reconciling accounts with multiple purchases.

Deploy the app after configuring secrets and applying the SQL. Validate first using read-only searches; do not use a real refund as a smoke test.
