PRAGMA foreign_keys = ON;

CREATE TABLE household_members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE budget_months (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL UNIQUE, -- YYYY-MM
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A bank you hold accounts with, and the built-in preset that reads its
-- statements.
CREATE TABLE banks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  preset TEXT NOT NULL CHECK (preset IN ('monzo','lloyds','revolut','natwest')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('main','joint','wallet','savings','other')),
  owner_member_id INTEGER,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bank_id INTEGER REFERENCES banks(id) ON DELETE SET NULL,
  account_identifier TEXT, -- from the first statement imported (Lloyds, NatWest)
  bank_product TEXT, -- the Revolut product this account is ('Current')
  FOREIGN KEY (owner_member_id) REFERENCES household_members(id) ON DELETE SET NULL
);

CREATE TABLE budget_incomes (
  id INTEGER PRIMARY KEY,
  budget_month_id INTEGER NOT NULL,
  household_member_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
  FOREIGN KEY (household_member_id) REFERENCES household_members(id) ON DELETE RESTRICT
);

-- Groups and categories are month-independent: "Groceries" in September and
-- in October is one category, which is what the transaction classifier
-- predicts. A month holds plan lines (budget_items) that point at a category.
CREATE TABLE budget_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
  collapsed INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id), -- default for a new plan line
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES budget_groups(id) ON DELETE RESTRICT
);

-- A month's plan line for one category.
CREATE TABLE budget_items (
  id INTEGER PRIMARY KEY,
  budget_month_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  sort_order INTEGER NOT NULL DEFAULT 0, -- within its group, in this month
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (budget_month_id, category_id),
  FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE budget_item_actual_entries (
  id INTEGER PRIMARY KEY,
  budget_item_id INTEGER NOT NULL,
  spent_on TEXT NOT NULL, -- YYYY-MM-DD
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  name TEXT, -- short label: what the spend was
  note TEXT, -- optional longer detail
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  import_row_id INTEGER REFERENCES import_rows(id) ON DELETE SET NULL, -- set when imported
  FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE
);

-- Upload transactions: statements staged for a month until confirmed. Only
-- the parsed rows and your decisions are stored; predictions and labels are
-- recomputed every time.
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  budget_month_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','imported','discarded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at TEXT,
  FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE
);

CREATE TABLE import_files (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  bank_account_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id, file_hash),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
);

CREATE TABLE import_rows (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL, -- position among the file's records
  raw TEXT NOT NULL, -- the CSV record as JSON
  -- Parsed. The dates, amount and direction are NULL only on a parse error.
  posted_on TEXT, -- YYYY-MM-DD
  spent_on TEXT, -- YYYY-MM-DD
  amount_cents INTEGER CHECK (amount_cents >= 0),
  direction TEXT CHECK (direction IN ('debit','credit')),
  descriptor_raw TEXT NOT NULL,
  descriptor_clean TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '{}', -- JSON: the bank's category, type code...
  parse_error TEXT,
  not_completed INTEGER NOT NULL DEFAULT 0 CHECK (not_completed IN (0,1)),
  fingerprint TEXT,
  -- Your decisions.
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT,
  kind TEXT CHECK (kind IN ('spend','transfer')), -- NULL: the classifier's prediction
  included INTEGER CHECK (included IN (0,1)), -- NULL: the labels' default
  linked_entry_id INTEGER REFERENCES budget_item_actual_entries(id) ON DELETE SET NULL,
  -- Set at confirm: an unticked row whose category you picked, which trains
  -- the classifier without becoming an entry. Cleared by undo.
  teaches INTEGER NOT NULL DEFAULT 0 CHECK (teaches IN (0,1)),
  UNIQUE (file_id, row_index),
  FOREIGN KEY (file_id) REFERENCES import_files(id) ON DELETE CASCADE
);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_budget_incomes_month ON budget_incomes(budget_month_id);
-- Backstop for the normalised-name check in the repository (which also
-- trims and collapses whitespace).
CREATE UNIQUE INDEX idx_categories_group_name ON categories(group_id, name COLLATE NOCASE);
CREATE INDEX idx_budget_items_category ON budget_items(category_id);
CREATE INDEX idx_actual_entries_item ON budget_item_actual_entries(budget_item_id);
CREATE INDEX idx_actual_entries_spent_on ON budget_item_actual_entries(spent_on);
CREATE UNIQUE INDEX idx_banks_name ON banks(name COLLATE NOCASE);
CREATE INDEX idx_actual_entries_import_row ON budget_item_actual_entries(import_row_id);
CREATE INDEX idx_import_batches_month ON import_batches(budget_month_id);
-- A month has at most one batch in progress.
CREATE UNIQUE INDEX idx_import_batches_one_pending ON import_batches(budget_month_id) WHERE status = 'pending';
CREATE INDEX idx_import_files_account ON import_files(bank_account_id);
CREATE INDEX idx_import_rows_fingerprint ON import_rows(fingerprint);
CREATE INDEX idx_import_rows_category ON import_rows(category_id);
CREATE INDEX idx_import_rows_linked_entry ON import_rows(linked_entry_id);
