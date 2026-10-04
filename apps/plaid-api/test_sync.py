"""Sidecar sync with Plaid stubbed out. No network and no access token on disk."""

from __future__ import annotations

import os
import unittest

os.environ["PLAID_SIDECAR_TOKEN"] = "test-token"

import main  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

TOKEN = {"X-Plaid-Sidecar-Token": "test-token"}


class LoginRequired(Exception):
    def __init__(self) -> None:
        super().__init__("ITEM_LOGIN_REQUIRED")
        self.body = "ITEM_LOGIN_REQUIRED"


class FakePlaid:
    def __init__(self, pages: list[dict] | None = None, error: Exception | None = None, fail_on: int | None = None):
        self.pages = pages or []
        self.error = error
        self.fail_on = fail_on
        self.calls = 0

    def transactions_sync(self, request):
        call = self.calls
        self.calls += 1
        if self.fail_on is not None and call == self.fail_on:
            raise self.error or RuntimeError("connection reset")
        if self.error and self.fail_on is None:
            raise self.error
        return self.pages[call]


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self._client = main._client
        self._read_store = main._read_store
        self._sync_request = main._sync_request
        main._read_store = lambda: {"items": {"item-1": {"access_token": "access-test"}}, "consumed": []}
        main._sync_request = lambda access_token, cursor: {"access_token": access_token, "cursor": cursor}

    def tearDown(self) -> None:
        main._client = self._client
        main._read_store = self._read_store
        main._sync_request = self._sync_request

    def post(self):
        return TestClient(main.app).post(
            "/transactions/sync",
            headers=TOKEN,
            json={"item_id": "item-1", "cursor": "old"},
        )

    def test_a_finished_page_maps_the_charge_and_the_balance(self) -> None:
        main._client = lambda: FakePlaid(
            pages=[
                {
                    "added": [
                        {
                            "transaction_id": "bank-1",
                            "amount": 6,
                            "merchant_name": "CAFE",
                            "date": "2026-09-10",
                            "pending": False,
                            "account_id": "acc-chk",
                            "personal_finance_category": {
                                "primary": "FOOD_AND_DRINK",
                                "detailed": "FOOD_AND_DRINK_GROCERIES",
                                "confidence_level": "HIGH",
                            },
                            "category": ["Food and Drink"],
                        }
                    ],
                    "modified": [],
                    "removed": [],
                    "accounts": [
                        {
                            "account_id": "acc-chk",
                            "name": "Checking",
                            "type": "depository",
                            "subtype": "checking",
                            "balances": {"current": 1500},
                        }
                    ],
                    "next_cursor": "cursor-2",
                    "has_more": False,
                }
            ]
        )
        res = self.post()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["login_required"], False)
        self.assertEqual(body["next_cursor"], "cursor-2")
        self.assertEqual(body["added"][0]["id"], "bank-1")
        self.assertEqual(body["added"][0]["merchant"], "CAFE")
        self.assertEqual(body["added"][0]["detailed"], "FOOD_AND_DRINK_GROCERIES")
        self.assertEqual(body["added"][0]["confidence"], "HIGH")
        self.assertEqual(body["accounts"][0]["kind"], "checking")
        self.assertEqual(body["accounts"][0]["current"], 1500)
        self.assertNotIn("recurring", body)

    def test_a_dead_login_returns_no_transactions(self) -> None:
        main._client = lambda: FakePlaid(error=LoginRequired())
        res = self.post()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["login_required"], True)
        self.assertEqual(body["added"], [])
        self.assertEqual(body["accounts"], [])
        self.assertEqual(body["next_cursor"], "old")

    def test_a_mid_page_failure_is_502_and_hides_the_partial_page(self) -> None:
        main._client = lambda: FakePlaid(
            fail_on=1,
            error=RuntimeError("connection reset"),
            pages=[
                {
                    "added": [
                        {
                            "transaction_id": "bank-1",
                            "amount": 6,
                            "merchant_name": "CAFE",
                            "date": "2026-09-10",
                            "pending": False,
                            "account_id": "acc-chk",
                            "personal_finance_category": {"primary": "FOOD_AND_DRINK", "detailed": "FOOD_AND_DRINK_GROCERIES"},
                        }
                    ],
                    "modified": [],
                    "removed": [],
                    "accounts": [],
                    "next_cursor": "mid",
                    "has_more": True,
                }
            ],
        )
        res = self.post()
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["detail"], "Plaid did not finish the sync. Balances were left as they were.")
        self.assertNotIn("bank-1", res.text)


if __name__ == "__main__":
    unittest.main()
