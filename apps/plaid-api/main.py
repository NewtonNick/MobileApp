"""Plaid sidecar. Holds access tokens only. Household books stay on the phone.

Sandbox is free. Trial uses the production host and stops at 10 Items.
Do not submit a paid Production application in this step.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import date, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Asset-aware Plaid sidecar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORE_PATH = Path(os.environ.get("PLAID_TOKEN_STORE", Path(__file__).with_name("token-store.bin")))
TRIAL_ITEM_CAP = 10
ANDROID_PACKAGE = os.environ.get("PLAID_ANDROID_PACKAGE_NAME", "app.assetaware.mobile")


def plaid_host(env: str | None = None) -> str:
    """Sandbox stays on the sandbox host. Trial is allowed to use production.plaid.com."""
    name = (env if env is not None else os.environ.get("PLAID_ENV", "sandbox")).strip().lower()
    if name == "sandbox":
        return "https://sandbox.plaid.com"
    if name == "trial":
        return "https://production.plaid.com"
    raise HTTPException(
        400,
        "Paid Production is not this step. Use PLAID_ENV=sandbox or PLAID_ENV=trial.",
    )


def require_secret(x_plaid_sidecar_token: str = Header(default="")) -> None:
    expected = os.environ.get("PLAID_SIDECAR_TOKEN", "")
    if not expected or not x_plaid_sidecar_token or len(x_plaid_sidecar_token) != len(expected):
        raise HTTPException(401, "Send PLAID_SIDECAR_TOKEN on X-Plaid-Sidecar-Token.")
    if not hmac.compare_digest(x_plaid_sidecar_token, expected):
        raise HTTPException(401, "Send PLAID_SIDECAR_TOKEN on X-Plaid-Sidecar-Token.")


def _fernet():
    from cryptography.fernet import Fernet

    raw = os.environ.get("PLAID_TOKEN_KEY") or os.environ.get("PLAID_SIDECAR_TOKEN") or ""
    if not raw:
        raise HTTPException(500, "Set PLAID_SIDECAR_TOKEN so access tokens can be encrypted.")
    digest = hashlib.sha256(raw.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _read_store() -> dict:
    if not STORE_PATH.exists():
        return {"items": {}, "consumed": []}
    try:
        payload = _fernet().decrypt(STORE_PATH.read_bytes())
        data = json.loads(payload.decode())
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, "Token store could not be opened.") from exc
    data.setdefault("items", {})
    data.setdefault("consumed", [])
    return data


def _write_store(data: dict) -> None:
    STORE_PATH.write_bytes(_fernet().encrypt(json.dumps(data).encode()))


def _plain(value):
    if hasattr(value, "to_dict"):
        return _plain(value.to_dict())
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, str):
        return enum_value
    return value


def _client():
    client_id = os.environ.get("PLAID_CLIENT_ID")
    secret = os.environ.get("PLAID_SECRET")
    if not client_id or not secret:
        raise HTTPException(400, "Set PLAID_CLIENT_ID and PLAID_SECRET. Books stay on the phone either way.")
    import plaid
    from plaid.api import plaid_api

    configuration = plaid.Configuration(
        host=plaid_host(),
        api_key={"clientId": client_id, "secret": secret},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def _login_required(exc: Exception) -> bool:
    body = getattr(exc, "body", None)
    text = body if isinstance(body, str) else str(exc)
    return "ITEM_LOGIN_REQUIRED" in text


def _kind(account: dict) -> str:
    subtype = str(account.get("subtype") or "").lower().replace(" ", "")
    account_type = str(account.get("type") or "").lower()
    if "saving" in subtype:
        return "savings"
    if account_type == "credit" or "credit" in subtype:
        return "credit"
    if subtype == "checking" or account_type == "depository":
        return "checking"
    return "other"


def _money(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        return _money(value.get("amount"))
    return None


def _recurring_outflows(client, access_token: str) -> list[dict] | None:
    """Active outflow streams. None means the call failed and stored bills should stay."""
    try:
        from plaid.model.transactions_recurring_get_request import TransactionsRecurringGetRequest

        page = _plain(client.transactions_recurring_get(TransactionsRecurringGetRequest(access_token=access_token)))
    except Exception:
        return None
    if not isinstance(page, dict):
        return None
    streams: list[dict] = []
    for row in page.get("outflow_streams") or []:
        if not isinstance(row, dict) or row.get("is_active") is False:
            continue
        status = str(row.get("status") or "").upper()
        if status in {"TOMBSTONED", "UNKNOWN"}:
            continue
        frequency = str(row.get("frequency") or "").upper()
        if not frequency or frequency == "UNKNOWN":
            continue
        amount = _money(row.get("average_amount"))
        if amount is None:
            amount = _money(row.get("last_amount"))
        if amount is None or amount <= 0:
            continue
        category = row.get("personal_finance_category") or {}
        if not isinstance(category, dict):
            category = {}
        next_date = str(row.get("predicted_next_date") or "")[:10]
        last_date = str(row.get("last_date") or "")[:10]
        streams.append(
            {
                "merchant": row.get("merchant_name") or row.get("description") or "Unknown",
                "amount": amount,
                "frequency": frequency,
                "next_date": next_date or None,
                "last_date": last_date or None,
                "primary": category.get("primary"),
                "detailed": category.get("detailed"),
            }
        )
    return streams


def _txn(row: dict) -> dict:
    category = row.get("personal_finance_category") or {}
    if not isinstance(category, dict):
        category = {}
    legacy = row.get("category") or []
    if not isinstance(legacy, list):
        legacy = []
    return {
        "id": row.get("transaction_id"),
        "amount": row.get("amount"),
        "merchant": row.get("merchant_name") or row.get("name") or "Unknown",
        "date": str(row.get("date") or "")[:10],
        "pending": bool(row.get("pending")),
        "pending_transaction_id": row.get("pending_transaction_id"),
        "account_id": row.get("account_id"),
        "primary": category.get("primary"),
        "detailed": category.get("detailed"),
        "confidence": category.get("confidence_level"),
        "legacy_category": [str(item) for item in legacy],
    }


def _account(row: dict) -> dict:
    balances = row.get("balances") or {}
    if not isinstance(balances, dict):
        balances = {}
    current = balances.get("current")
    return {
        "plaid_account_id": row.get("account_id"),
        "name": row.get("name") or row.get("official_name") or "",
        "kind": _kind(row),
        "current": current if isinstance(current, (int, float)) else None,
    }


class LinkTokenIn(BaseModel):
    client_user_id: str
    item_id: str | None = None


class ExchangeIn(BaseModel):
    public_token: str


class SyncIn(BaseModel):
    item_id: str
    cursor: str | None = None


class RemoveIn(BaseModel):
    item_id: str


@app.get("/health")
def health():
    env = os.environ.get("PLAID_ENV", "sandbox")
    try:
        host = plaid_host(env)
    except HTTPException:
        host = None
    return {"ok": True, "env": env, "paid_production": False, "host": host}


@app.post("/link/token")
def link_token(body: LinkTokenIn, _: None = Depends(require_secret)):
    if not body.client_user_id.strip():
        raise HTTPException(400, "client_user_id is required.")
    access_token = None
    if body.item_id:
        store = _read_store()
        saved = store["items"].get(body.item_id)
        if not saved:
            raise HTTPException(404, "That institution is not on this sidecar. Link it again.")
        access_token = saved["access_token"]
    from plaid.model.country_code import CountryCode
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products

    kwargs = {
        "user": LinkTokenCreateRequestUser(client_user_id=body.client_user_id.strip()),
        "client_name": "Asset Aware",
        "country_codes": [CountryCode("US")],
        "language": "en",
        "android_package_name": ANDROID_PACKAGE,
    }
    if access_token:
        kwargs["access_token"] = access_token
    else:
        kwargs["products"] = [Products("transactions")]
    try:
        created = _plain(_client().link_token_create(LinkTokenCreateRequest(**kwargs)))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if _login_required(exc):
            raise HTTPException(409, "This bank needs a refresh.") from exc
        raise HTTPException(502, "Plaid did not create a link token.") from exc
    token = created.get("link_token") if isinstance(created, dict) else None
    if not token:
        raise HTTPException(502, "Plaid did not create a link token.")
    return {"link_token": token}


@app.post("/item/public_token/exchange")
def exchange(body: ExchangeIn, _: None = Depends(require_secret)):
    env = os.environ.get("PLAID_ENV", "sandbox").strip().lower()
    store = _read_store()
    if env == "trial" and len(store["consumed"]) >= TRIAL_ITEM_CAP:
        raise HTTPException(403, "Trial allows 10 Items for the team. Removing one does not free a slot.")
    from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest

    try:
        exchanged = _plain(
            _client().item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=body.public_token))
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, "Plaid did not exchange that token.") from exc
    if not isinstance(exchanged, dict):
        raise HTTPException(502, "Plaid did not exchange that token.")
    access_token = exchanged.get("access_token")
    item_id = exchanged.get("item_id")
    if not access_token or not item_id:
        raise HTTPException(502, "Plaid did not exchange that token.")
    store["items"][item_id] = {"access_token": access_token}
    if item_id not in store["consumed"]:
        store["consumed"].append(item_id)
    _write_store(store)
    return {"item_id": item_id}


@app.post("/item/remove")
def remove_item(body: RemoveIn, _: None = Depends(require_secret)):
    """Drop the access token. Trial still counts the Item. Books stay on the phone."""
    if not body.item_id.strip():
        raise HTTPException(400, "item_id is required.")
    store = _read_store()
    saved = store["items"].pop(body.item_id, None)
    _write_store(store)
    if not saved:
        return {"removed": False}
    try:
        from plaid.model.item_remove_request import ItemRemoveRequest

        _client().item_remove(ItemRemoveRequest(access_token=saved["access_token"]))
    except Exception:
        pass
    return {"removed": True}


def _sync_request(access_token: str, cursor: str):
    from plaid.model.transactions_sync_request import TransactionsSyncRequest

    return TransactionsSyncRequest(access_token=access_token, cursor=cursor)


def _sync_transactions(client, access_token: str, cursor: str) -> dict:
    """One institution's page, already mapped. Raises if Plaid dies before the page is done."""
    added: list[dict] = []
    modified: list[dict] = []
    removed: list[str] = []
    accounts: dict[str, dict] = {}
    has_more = True
    pages = 0
    while has_more and pages < 50:
        page = _plain(client.transactions_sync(_sync_request(access_token, cursor)))
        if not isinstance(page, dict):
            break
        for row in page.get("added") or []:
            if isinstance(row, dict):
                added.append(_txn(row))
        for row in page.get("modified") or []:
            if isinstance(row, dict):
                modified.append(_txn(row))
        for row in page.get("removed") or []:
            if isinstance(row, dict) and row.get("transaction_id"):
                removed.append(str(row["transaction_id"]))
        for row in page.get("accounts") or []:
            if isinstance(row, dict) and row.get("account_id"):
                accounts[str(row["account_id"])] = _account(row)
        cursor = str(page.get("next_cursor") or cursor)
        has_more = bool(page.get("has_more"))
        pages += 1
    return {
        "added": added,
        "modified": modified,
        "removed": removed,
        "accounts": list(accounts.values()),
        "next_cursor": cursor,
    }


@app.post("/transactions/sync")
def sync(body: SyncIn, _: None = Depends(require_secret)):
    store = _read_store()
    saved = store["items"].get(body.item_id)
    if not saved:
        raise HTTPException(404, "That institution is not on this sidecar.")
    client = _client()
    try:
        page = _sync_transactions(client, saved["access_token"], body.cursor or "")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if _login_required(exc):
            return {
                "item_id": body.item_id,
                "next_cursor": body.cursor or "",
                "login_required": True,
                "accounts": [],
                "added": [],
                "modified": [],
                "removed": [],
            }
        raise HTTPException(502, "Plaid did not finish the sync. Balances were left as they were.") from exc
    result = {
        "item_id": body.item_id,
        "next_cursor": page["next_cursor"],
        "login_required": False,
        "accounts": page["accounts"],
        "added": page["added"],
        "modified": page["modified"],
        "removed": page["removed"],
    }
    recurring = _recurring_outflows(client, saved["access_token"])
    if recurring is not None:
        result["recurring"] = recurring
    return result
