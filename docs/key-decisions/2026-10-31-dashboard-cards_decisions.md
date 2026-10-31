# 2026-10-31 key decisions: dashboard cards

**Related:** [dashboard](../features/dashboard_feature.md)

**Engineer** is the person who works on the app. The **Planner Agent** proposed the plan and the **Coding Agent** built it.

The Engineer wanted the Dashboard to show behaviour over time, and asked to drop the fixed headline, "Category trends" and "Runs over most often", and to put cards the household chooses at the top.

## 1. Patterns over time only, no "this month" stats

- **Context:** the first list of proposed stats included readings of a single month (saved last month, left to assign this month).
- **Decision:** every stat is a pattern across months. Nothing reads the current month on its own.
- **Alternatives:** a mix of current-month and long-run stats.
- **Why:** the Month Budget screen already shows the month; the Dashboard is where habits show.
- **Decided by:** Engineer.

## 2. A 4 × 3 grid the household arranges, size as weight

- **Context:** the first build had four fixed cards, the first one large. Long figures wrapped badly in the row, and the Engineer wanted to choose how many cards there are and how much space each takes.
- **Decision:** a grid 4 columns wide and up to 3 rows deep. Each card covers a rectangle of cells, from one to all twelve; only the rows in use take space. A card's figure is drawn at one of three type rungs (20, 30, 46) by the cells it covers, the largest wearing the accent's text blend. Cards are arranged in an editing mode: click or drag across free cells to add, drag to move, drag the corner to resize, and arrows, Shift and arrows, and Delete from the keyboard. A move or resize that does not fit is refused rather than pushing other cards aside.
- **Alternatives:** four fixed slots with the first large (the first build); a size picker in each card's menu instead of dragging; letting a move push or swap other cards.
- **Why:** the grid and its bounds are the Engineer's. Size as weight keeps DESIGN.md's single-lead hierarchy without fixing which card leads: the household says what leads by making it bigger. Dragging over cells is the direct way to say "this rectangle"; the keyboard path covers the same moves. Refusing a move keeps every other card where the household put it.
- **Decided by:** Engineer (the grid, its size, any card any size); Coding Agent (the editing gestures, size rungs, refusing overlaps).

## 3. The window is the last 12 finished months

- **Context:** averages and counts need a period, and the current month is only partly tracked.
- **Decision:** "all time" and "this year" add every month up to now. Everything else reads the last 12 months **before** the current calendar month, counting only months that have what the stat measures.
- **Alternatives:** the same 12 months as the charts, which include the month in progress; all time.
- **Why:** the Engineer chose 12 months. Leaving out the month in progress was the Coding Agent's call: half a month would always be the lightest month, within plan, and drag averages down. Skipping untracked months stops a gap being read as a month of no spending.
- **Decided by:** Engineer (12 months); Coding Agent (finished months only, skipping untracked ones).

## 4. Savings are not spending

- **Context:** "spending" could mean everything entered, or only money out of spend and debt groups.
- **Decision:** spending stats leave out what went into savings groups, except the one stat that says "with savings". The plan stats compare the whole plan with everything entered.
- **Alternatives:** count everything everywhere.
- **Why:** money put aside is not spent; counting it would make a household that saves more look like it spends more. The Engineer asked for spend both with and without savings, so both exist.
- **Decided by:** Engineer (both variants); Coding Agent (savings left out of the other spending stats).

## 5. Group or category, and the same stat on several cards

- **Context:** "spend on a category of my choosing" could take categories only.
- **Decision:** the choice offers spend groups with their categories under them, and a stat can sit on more than one card with different choices. Choices are stored by id.
- **Alternatives:** categories only; one card per stat.
- **Why:** a group (Eating out, Transport) often says more than one category. Ids survive a rename.
- **Decided by:** Engineer (groups too, several cards); Coding Agent (ids).

## 6. "Income against the year before" compares 12 months with the 12 before

- **Context:** the proposal said "this year against last".
- **Decision:** the average monthly income in the window against the 12 months before it.
- **Alternatives:** calendar year to date against last calendar year.
- **Why:** it matches the window every other stat uses, and does not swing in January when the year has one month in it.
- **Decided by:** Coding Agent.

## 7. Stored as a setting in app_meta, checked by shape only

- **Context:** the choice has to be remembered.
- **Decision:** JSON under `dashboardCards` in `app_meta`, through `settings:update`. The main process checks the shape (inside the grid, no overlaps, at most twelve) and refuses a bad write; the renderer owns the stat ids, and a card with one it does not know keeps its place and asks for a stat.
- **Alternatives:** browser storage; a table; validating stat ids in the main process.
- **Why:** `app_meta` is where settings without a normalised home go, and it travels with the database. Keeping the stat list in one place (the renderer) means adding a stat touches one file.
- **Decided by:** Coding Agent.
