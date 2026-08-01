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

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('main','joint','wallet','savings','other')),
  owner_member_id INTEGER,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

CREATE TABLE budget_groups (
  id INTEGER PRIMARY KEY,
  budget_month_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
  collapsed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE
);

CREATE TABLE budget_items (
  id INTEGER PRIMARY KEY,
  budget_group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (budget_group_id) REFERENCES budget_groups(id) ON DELETE CASCADE
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
  FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE
);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_budget_incomes_month ON budget_incomes(budget_month_id);
CREATE INDEX idx_budget_groups_month ON budget_groups(budget_month_id);
CREATE INDEX idx_budget_items_group ON budget_items(budget_group_id);
CREATE INDEX idx_actual_entries_item ON budget_item_actual_entries(budget_item_id);
CREATE INDEX idx_actual_entries_spent_on ON budget_item_actual_entries(spent_on);
