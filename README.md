# ERP AUTO PLANNER (Chrome Extension)

## 1) Planning Page — Section Selection
Fully editable section list — add, remove, or reorder sections directly in the popup, right above the "Run on Planning Page" button:

- **Add**: click **"+ Add Section"**, then type a code and a name.
- **Remove**: click the **✕** button next to any row.
- **Reorder**: use the **▲ / ▼** buttons to change the order sections are selected in.

Your list is saved automatically and remembered the next time you open the popup. It starts out with these 7 sections by default:

| Code | Section Name |
|------|--------------|
| 93   | Central Cutting |
| 10   | Tie |
| 12   | Screen Printing |
| 07   | Field Receive and Distribution |
| 05   | Washing |
| 34   | Household-Sewing |
| 06   | Ironing |

## 2) Wages Page — Actual/Payable Wages and Overhead Cost
For every section row found on the wages page:
- **Actual Wages** = 0.01
- **Payable Wages** = 0.01
- **Overhead Cost** = the total value you enter in the popup, divided by however many section rows actually exist on that page (truncated to 2 decimals, not rounded). Example: 7 rows, total 25.32 → 25.32 ÷ 7 = 3.6171... → 3.61 goes into each row. If you add/remove sections so a different number of rows end up on the page, the division adjusts automatically — it always matches however many rows are really there. The last total you entered is remembered and can be changed.

## Installation

1. Unzip this file into a folder.
2. In Chrome, go to `chrome://extensions`
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. The extension icon will appear in your Chrome toolbar.

(If you're updating from an older version: click **Remove** on the old one first, then load the new folder — this avoids leftover settings mismatches.)

## How to Use

**To select sections:**
1. Open the order's planning page.
2. Click the extension icon. Adjust the section list if needed (add/remove/reorder).
3. Click **"Run on Planning Page ▶"**.

**To fill wages:**
1. Open the order's wages page.
2. Click the extension icon, enter that order's **total Overhead Cost** in the box (e.g. 25.32).
3. Click **"Run on Wages Page ▶"** — the total is divided by however many rows are found on the page, and the result is filled into every row.

## Important Notes

This script was built directly from the real HTML you provided (a Material-UI/MUI based ERP). Key fixes made along the way:

- The result-row search matches **both code and name** (avoids clicking the wrong row if a code happens to repeat elsewhere)
- The results panel (`id="scrollableDiv"`) is scrollable — if an item further down the list isn't visible at first, the script scrolls automatically to find it
- The section list is now fully editable and persisted, and the wages division is based on the actual row count on the page rather than a fixed number

**If something doesn't work:** send a screenshot along with whatever error message appears. A "No wages rows found" error would mean the row class pattern is slightly different on that page — in that case, send that row's HTML again and it'll be fixed.
