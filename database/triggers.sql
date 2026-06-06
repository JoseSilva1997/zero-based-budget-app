CREATE TRIGGER household_members_set_updated_at
AFTER UPDATE ON household_members
FOR EACH ROW
BEGIN
  UPDATE household_members
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER budget_months_set_updated_at
AFTER UPDATE ON budget_months
FOR EACH ROW
BEGIN
  UPDATE budget_months
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER budget_incomes_set_updated_at
AFTER UPDATE ON budget_incomes
FOR EACH ROW
BEGIN
  UPDATE budget_incomes
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER budget_groups_set_updated_at
AFTER UPDATE ON budget_groups
FOR EACH ROW
BEGIN
  UPDATE budget_groups
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER budget_items_set_updated_at
AFTER UPDATE ON budget_items
FOR EACH ROW
BEGIN
  UPDATE budget_items
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER actual_entries_set_updated_at
AFTER UPDATE ON budget_item_actual_entries
FOR EACH ROW
BEGIN
  UPDATE budget_item_actual_entries
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
