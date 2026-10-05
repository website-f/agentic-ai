# Webhooks

Our API can notify your server when something happens in your account, such as a payment succeeding or a refund being issued. This page explains how to register an endpoint, verify signatures and handle retries.

## Registering an endpoint

Go to **Settings > Developers > Webhooks** in the dashboard and click **Add endpoint**. Enter an HTTPS URL that can receive POST requests, then pick the events you want. You can register up to 16 endpoints per account.

## Verifying signatures

Every request carries an `X-Signature` header. Compute an HMAC-SHA256 of the raw request body with your endpoint secret and compare it with the header in constant time. Reject requests whose timestamp is more than 5 minutes old to block replays.

```python
import hmac, hashlib
expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, header)
```

## Retries

If your endpoint does not answer with a 2xx status within 10 seconds, we retry with exponential backoff for up to **3 days**: after 1 minute, 5 minutes, 30 minutes, 2 hours, then every 6 hours. After 3 days of failures the endpoint is disabled and the account owner gets an email.

| Attempt | Delay after previous |
|---|---|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 30 minutes |
| 4 | 2 hours |
| 5+ | 6 hours |

## Event types

- `payment.succeeded` - a payment was captured
- `payment.failed` - a payment attempt was declined
- `refund.created` - a refund was issued
- `payout.paid` - money arrived in your bank account

See the [full event reference](https://docs.example.com/events) for payload schemas.
