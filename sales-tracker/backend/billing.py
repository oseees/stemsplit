"""Paystack billing for SalesPal — stdlib only (urllib), no extra deps.

Manual monthly model: a successful charge buys a fixed amount of Pro time.
The secret key lives in PAYSTACK_SECRET_KEY; when unset, billing is disabled
and the rest of the app keeps working.
"""
import os
import json
import hmac
import hashlib
import urllib.request
import urllib.error

PAYSTACK_BASE = "https://api.paystack.co"


def _secret():
    return os.environ.get("PAYSTACK_SECRET_KEY", "").strip()


def enabled():
    return bool(_secret())


def _request(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        PAYSTACK_BASE + path, data=data, method=method,
        headers={
            "Authorization": f"Bearer {_secret()}",
            "Content-Type": "application/json",
            # Paystack sits behind Cloudflare, which 403s the default
            # "Python-urllib" agent — send a normal one.
            "User-Agent": "SalesPal/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"status": False, "message": f"HTTP {e.code}"}


def init_transaction(email, amount_kobo, reference, callback_url, metadata,
                     subaccount=None):
    payload = {
        "email": email,
        "amount": int(amount_kobo),
        "reference": reference,
        "callback_url": callback_url,
        "metadata": metadata,
        "currency": "NGN",
    }
    if subaccount:
        # Route settlement straight to the merchant's subaccount, and make the
        # subaccount bear Paystack's processing fee so SalesPal (the main
        # account) neither holds funds nor pays fees on their behalf.
        payload["subaccount"] = subaccount
        payload["bearer"] = "subaccount"
    return _request("POST", "/transaction/initialize", payload)


def verify_transaction(reference):
    return _request("GET", f"/transaction/verify/{reference}")


# --------------------------- Merchant payout (subaccounts) ------------------
# For collecting invoice payments: each merchant gets a Paystack subaccount so
# funds settle to *their* bank. percentage_charge is the platform's cut — 0
# means the merchant keeps everything (Pro-gated feature, no platform fee).
def list_banks():
    """Nigerian banks (name + code) for the payout bank picker."""
    res = _request("GET", "/bank?currency=NGN&perPage=100")
    if not res.get("status"):
        return []
    seen, out = set(), []
    for b in res.get("data") or []:
        code = b.get("code")
        if code and code not in seen:
            seen.add(code)
            out.append({"name": b.get("name"), "code": code})
    out.sort(key=lambda x: (x["name"] or "").lower())
    return out


def resolve_account(account_number, bank_code):
    """Confirm a bank account and return its registered account name."""
    return _request(
        "GET",
        f"/bank/resolve?account_number={account_number}&bank_code={bank_code}")


def create_subaccount(business_name, bank_code, account_number,
                      percentage_charge=0):
    return _request("POST", "/subaccount", {
        "business_name": business_name,
        "settlement_bank": bank_code,
        "account_number": account_number,
        "percentage_charge": percentage_charge,
    })


def update_subaccount(subaccount_code, business_name, bank_code, account_number,
                      percentage_charge=0):
    return _request("PUT", f"/subaccount/{subaccount_code}", {
        "business_name": business_name,
        "settlement_bank": bank_code,
        "account_number": account_number,
        "percentage_charge": percentage_charge,
    })


def verify_webhook(raw_body: bytes, signature: str) -> bool:
    """Validate Paystack's x-paystack-signature (HMAC-SHA512 of the raw body)."""
    if not signature or not _secret():
        return False
    digest = hmac.new(_secret().encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, signature)
