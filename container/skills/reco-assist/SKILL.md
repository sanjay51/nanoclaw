---
name: reco-assist
description: >
  Customer support investigation tool for RecoCards.com. Use this skill whenever a customer
  reports a billing issue, subscription problem, unexpected charge, or account question.
  Also trigger when someone asks to look up a user by email, check a Stripe transaction,
  investigate a payment, or verify premium status. Common triggers: "customer says...",
  "user is being charged", "cancel subscription", "check if they have premium",
  "look up user", any customer email address followed by a billing question.
---

# RecoCards Customer Support Investigation

You are helping a RecoCards admin investigate a customer's billing or subscription issue.
Your job is to gather the facts from Firebase and Stripe, then present a clear summary
of what's going on so the admin can decide what action to take.

## How this works

A customer typically reaches out with something like "I'm being charged but I don't have
a subscription" or "I want to cancel." You have access to two CLIs — `firebase` and
`stripe` — that let you look up the real data. Your goal is to trace the full picture:
who is this person, what did they pay for, and is their subscription still active?

This is read-only investigation. Present findings and recommend actions, but don't
make changes (cancellations, refunds, etc.) unless the admin explicitly asks you to.

## Credentials setup

Before running any commands, load both keys at the start of every investigation.
These files may be updated between sessions, so always read them fresh.

**Stripe:**
```bash
export STRIPE_API_KEY=$(cat ~/.sanjay/stripe_api_key.txt)
```
Pass `--api-key "$STRIPE_API_KEY"` to every `stripe` CLI command.

**Firebase (service account):**
```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/.sanjay/happyfarewell-51daa-firebase-adminsdk-6us5g-7ad7ae25d8.json
```
This authenticates the `firebase` CLI and also enables direct Firestore REST API access
via `gcloud` or `curl` with a bearer token. To get a token for REST calls:
```bash
export FIREBASE_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || \
  python3 -c "
import json, google.auth.transport.requests, google.oauth2.service_account
creds = google.oauth2.service_account.Credentials.from_service_account_file(
    '$HOME/.sanjay/firebase_config_recocards.txt',
    scopes=['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/firebase'])
creds.refresh(google.auth.transport.requests.Request())
print(creds.token)
")
```
If neither `gcloud` nor the Python google-auth library is available, fall back to the
`firebase` CLI (which authenticates via `firebase login`).

## Investigation workflow

### Step 1: Identify the user

The customer usually provides an email. Use Stripe CLI to find their customer record:

```bash
stripe customers list --email "customer@example.com" --limit 5 --api-key "$STRIPE_API_KEY"
```

This returns customer objects with IDs like `cus_xxx`. Note the customer ID, name, and
creation date. A customer may have multiple Stripe customer records if they've used
different payment methods over time — check all of them.

If the email returns no results, try variations (gmail dots don't matter, check for typos).

### Step 2: Check Stripe subscriptions

For each Stripe customer ID found:

```bash
stripe subscriptions list --customer cus_xxx --limit 10 --expand data.default_payment_method --api-key "$STRIPE_API_KEY"
```

Key fields to look at:
- `status`: "active", "canceled", "past_due", "trialing", "incomplete"
- `current_period_start` / `current_period_end`: billing cycle dates
- `cancel_at_period_end`: true means scheduled to cancel at period end
- `items.data[0].price.unit_amount`: price in cents
- `items.data[0].price.recurring.interval`: "month" or "year"
- `default_payment_method`: the card being charged

### Step 3: Check recent charges

```bash
stripe charges list --customer cus_xxx --limit 10 --api-key "$STRIPE_API_KEY"
```

Look at:
- `amount`: in cents (divide by 100 for dollars)
- `currency`: usually "usd"
- `status`: "succeeded", "pending", "failed"
- `created`: Unix timestamp of when the charge happened
- `description`: what the charge was for
- `invoice`: if linked to a subscription invoice

For a specific charge:
```bash
stripe charges retrieve ch_xxx --api-key "$STRIPE_API_KEY"
```

### Step 4: Check Firebase user profile

The Firebase project for production is `happyfarewell-51daa`. The service account key
(`GOOGLE_APPLICATION_CREDENTIALS`) gives you direct access to both Firebase Auth and
Firestore — no need to go through Cloud Functions.

**Find the UID from email** using Firebase Auth (via a quick Python script):
```bash
python3 -c "
import firebase_admin
from firebase_admin import credentials, auth
cred = credentials.Certificate('$HOME/.sanjay/firebase_config_recocards.txt')
app = firebase_admin.initialize_app(cred)
user = auth.get_user_by_email('customer@example.com')
print(f'UID: {user.uid}')
print(f'Email: {user.email}')
print(f'Created: {user.user_metadata.creation_timestamp}')
print(f'Last sign-in: {user.user_metadata.last_sign_in_timestamp}')
"
```
If firebase_admin isn't installed, run `pip install firebase-admin --break-system-packages` first.

**Read the user profile from Firestore** once you have the UID:
```bash
curl -s -H "Authorization: Bearer $FIREBASE_TOKEN" \
  "https://firestore.googleapis.com/v1/projects/happyfarewell-51daa/databases/(default)/documents/user-profile/USER_UID"
```

Or via Python with the same service account:
```bash
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
cred = credentials.Certificate('$HOME/.sanjay/firebase_config_recocards.txt')
try:
    app = firebase_admin.get_app()
except ValueError:
    app = firebase_admin.initialize_app(cred)
db = firestore.client()
doc = db.collection('user-profile').document('USER_UID').get()
print(doc.to_dict())
"
```

You can combine both lookups (find UID by email + read profile) into a single script
for efficiency.

Key fields in `user-profile/{uid}`:
- `subscriptionStartDate`: when premium started
- `subscriptionEndDate`: when premium expires
- `subscriptionPlan`: the plan name
- `subscriptionStripeCheckoutSessionId`: links back to the Stripe checkout session

Key fields in `static-user-profile/{uid}`:
- `credits`: AI credit balance
- `email`: stored email

### Step 5: Cross-reference and diagnose

Now connect the dots. Common scenarios:

**"I'm being charged but I don't have a subscription"**
1. Check Stripe: is there an active subscription? What's being charged and when?
2. Check Firebase `user-profile`: does `subscriptionEndDate` show active premium?
3. Possible causes:
   - They DO have an active sub but forgot (show them the dates and amounts)
   - They cancelled in the app but Stripe sub is still active (app-side vs Stripe-side mismatch)
   - They have a subscription under a different email
   - A family member signed up using their payment method

**"I want to cancel my subscription"**
1. Find the active Stripe subscription
2. Note the `subscriptionStripeCheckoutSessionId` from Firebase
3. Provide the admin with the subscription ID (`sub_xxx`) for cancellation
4. Check if `cancel_at_period_end` is already true (maybe they already cancelled)

**"I paid but I don't have premium"**
1. Check Stripe: did the payment succeed? (`status: "succeeded"`)
2. Check Firebase `user-profile`: is `subscriptionEndDate` in the future?
3. Possible causes:
   - Payment succeeded but Firebase wasn't updated (webhook failure)
   - They paid for a one-time purchase, not a subscription
   - `subscriptionEndDate` is in the past (subscription expired)

**"I got charged twice"**
1. List all charges: `stripe charges list --customer cus_xxx --created gt:TIMESTAMP`
2. Check if there are duplicate charges near the same time
3. Look at whether each charge has a different invoice (separate billing events) or the same

## Presenting findings

After investigating, present your findings in a clear summary like this:

```
## Customer: [name] ([email])
- **Stripe Customer ID:** cus_xxx
- **Firebase UID:** [uid or "not found"]

## Subscription Status
- **Stripe:** [Active/Cancelled/None] — $X/month, renews [date]
- **Firebase:** subscriptionEndDate = [date], plan = [plan]
- **Match:** [Yes / No — explain discrepancy]

## Recent Charges
- [date]: $X — [description] — [status]
- [date]: $X — [description] — [status]

## Diagnosis
[Plain-language explanation of what's going on]

## Recommended Action
[What the admin should do next]
```

## Environment reference

| Resource | Production |
|---|---|
| Firebase Project | `happyfarewell-51daa` |
| Cloud Functions | `https://us-central1-happyfarewell-51daa.cloudfunctions.net/` |
| Firestore user-profile | `user-profile/{uid}` |
| Firestore static-user-profile | `static-user-profile/{uid}` |
| Stripe API key | `~/.sanjay/stripe_api_key.txt` (load fresh each session) |
| Firebase service account | `~/.sanjay/happyfarewell-51daa-firebase-adminsdk-6us5g-7ad7ae25d8.json` (service account JSON) |

## Important notes

- Stripe amounts are in **cents**. Divide by 100 to get dollars.
- Stripe timestamps are **Unix epoch seconds**. Convert to human-readable dates.
- A customer might have multiple Stripe customer objects (different emails, payment methods).
- Firebase `subscriptionEndDate` is the source of truth for whether the app treats them as premium.
  If Stripe says active but Firebase says expired, the user won't see premium features.
- Always check both systems — they can get out of sync.
