# ledgerline

Small invoicing helpers used by the billing service.

- `src/money.js` — integer-cent parsing, formatting and allocation
- `src/tax.js` — VAT rates per region and per-line tax
- `src/invoice.js` — invoice construction and totals
- `src/csv.js` — CSV export for the accounting import
- `src/errors.js` — the `LedgerError` type

Run the tests with `npm test` (Node's built-in test runner, no dependencies).
