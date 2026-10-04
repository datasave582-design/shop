# Shop Management (Windows Desktop) — Phase 2

Offline Windows shop software: Electron + React + TypeScript + Express + SQLite (WAL).
Data owner ke PC par rehta hai; internet ki zaroorat nahi.

## Status

| Phase | Kya | Status |
|---|---|---|
| 1 | Desktop shell, local DB, setup wizard, login/roles/audit, settings, installer build | Done |
| 2 | Products, categories, inventory, stock movements, expiry | **Done (ye ZIP)** |
| 3 | POS, sale transaction, invoice, A4/58mm/80mm print, barcode | Next |
| 4 | Purchase, customers/suppliers, returns, expenses | |
| 5 | Reports, daily closing, import/export, backup/restore | |
| 6 | LAN mode, auto-start polish, PWA client | |

## Phase 1 mein kya hai
- Own window wali desktop app + system tray (Open / server status / Windows ke saath start / Exit). Window band karne par app tray mein chalti rehti hai.
- Local SQLite DB: `C:\ProgramData\ShopManagement\Data\shop.db` (WAL, foreign keys, migrations).
- First-run setup wizard (shop, owner/admin, contact, currency, business type, Single PC / LAN choice).
- Login, logout, change password (bcrypt), session expiry (12 ghante) + 30 min idle logout, 5 galat try = 1 min lock.
- Roles: Owner, Manager, Billing Staff, Inventory Staff + custom roles; permission-based API protection.
- Audit log (login/logout, user/role/permission/settings changes, setup).
- Shop settings, dark mode, responsive UI.
- Update se pehle automatic DB safety backup (`Backups\pre-update-*.db`).
- Uninstall par "Shop data ko rakhna hai?" prompt (default Keep Data).

## Phase 2 mein naya kya hai
- **Products**: saare fields (SKU, barcode, category/subcategory, brand, unit, purchase/selling/MRP, discount, GST, min/max stock, rack, status, image), add/edit/view/duplicate/delete, search + filters (category, brand, stock status, expiry, status) + sort + pagination. Selling price MRP se zyada nahi ho sakta. Delete soft-delete hai (history bachi rehti hai) aur stock bacha ho to delete nahi hota.
- **Categories / Subcategories / Brands / Units** (default units: Piece, Box, Packet, Kg, Gram, Litre, ml, Meter, Dozen + custom).
- **Barcode**: auto EAN-13 generate, USB scanner (search box mein scan + Enter => product khul jata hai), exact lookup API `/api/products/lookup?code=`. (Label printing Phase 3.)
- **Inventory**: opening stock, stock in, stock out, damage, lost, physical-count adjustment. **Har movement ledger (`stock_movements`) mein** reason + user ke saath. Negative stock kabhi nahi. Stock batch-wise rehta hai; stock out/damage mein **FEFO** (pehle jiski expiry jaldi). Product ka `current_stock` = batches ka sum = ledger ka sum (tests mein check hota hai).
- **Expiry**: batch number + mfg/expiry; Expired / Aaj / 7 / 30 / 60 din / custom range filter; dashboard par Expiring soon / Expired cards. (Expired sale block Phase 3 POS mein, setting pehle se maujood.)
- **Stock status**: 🔴 Out, 🟠 Critical (<= min ka aadha), 🟡 Low (<= min), 🟢 Healthy.
- Dashboard: stock cards (products, stock, stock value, low, out, expiring, expired) + quick actions.
- Phase 1 database upgrade par data safe rehta hai (migration + auto pre-update backup, test mein verified).

## Folders
```
client/    React UI (Vite)        server/     Express API + SQLite
electron/  Desktop wrapper        installer/  NSIS uninstall script
build/     App icon               .github/    Windows build workflow
```
Runtime data: `C:\ProgramData\ShopManagement\{Data,Backups,Logs,Uploads,Exports}` + `config.json` (random secret, sirf server ke paas).

## Installer (.exe) kaise milega — PC par code chalane ki zaroorat nahi
1. Is folder ko GitHub repo mein upload karein (node_modules ke bina).
2. Repo → **Actions → Build Windows Installer → Run workflow**.
3. Run poora hone par **Artifacts → ShopManagement-Setup** download karein, zip kholein, `ShopManagement-Setup.exe` chalayein.

Installer: location choose, Desktop + Start Menu shortcut, Installed Apps entry, Uninstall.
Installer unsigned hai, isliye SmartScreen "More info → Run anyway" dikha sakta hai.

## Developer setup
```
npm run setup          # root + client dependencies
npm test               # API tests (auth, roles, audit, settings)
npm run dev:server     # API on :3000 (data: ./dev-data)
npm run dev:client     # UI on :5173
npm run rebuild:electron && npm start   # desktop window (Windows)
npm run dist           # installer -> release/ShopManagement-Setup.exe (Windows)
```
`.env.example` sirf dev ke liye hai. Real secrets kabhi commit na karein.

## Security (Phase 1)
Server sirf `127.0.0.1` par sunta hai. Passwords bcrypt hash; JWT secret frontend ko nahi jaata; sensitive API login + permission se protected; input zod se validate; secure headers + CSP; raw DB errors user ko nahi dikhte (`Logs\server.log` mein jaate hain).

## Abhi nahi hai
Stock transfer (branches ke saath), supplier link on products (Phase 4), import/export (Phase 5), barcode label print (Phase 3).
LAN client connect + firewall guide + PWA (Phase 6); backup/restore UI (Phase 5; abhi sirf auto pre-update backup); per-user individual permissions (custom roles se kaam chalta hai).

## License
Private / all rights reserved.
