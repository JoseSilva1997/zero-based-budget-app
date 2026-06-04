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

CREATE TRIGGER budget_group_templates_set_updated_at
AFTER UPDATE ON budget_group_templates
FOR EACH ROW
BEGIN
  UPDATE budget_group_templates
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER budget_item_templates_set_updated_at
AFTER UPDATE ON budget_item_templates
FOR EACH ROW
BEGIN
  UPDATE budget_item_templates
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

CREATE TRIGGER actual_entries_after_insert
AFTER INSERT ON budget_item_actual_entries
FOR EACH ROW
BEGIN
  UPDATE budget_items
  SET actual_cents = (
    SELECT COALESCE(SUM(amount_cents), 0)
    FROM budget_item_actual_entries
    WHERE budget_item_id = NEW.budget_item_id
  )
  WHERE id = NEW.budget_item_id;
END;

CREATE TRIGGER actual_entries_after_update
AFTER UPDATE ON budget_item_actual_entries
FOR EACH ROW
BEGIN
  UPDATE budget_items
  SET actual_cents = (
    SELECT COALESCE(SUM(amount_cents), 0)
    FROM budget_item_actual_entries
    WHERE budget_item_id = NEW.budget_item_id
  )
  WHERE id = NEW.budget_item_id;

  UPDATE budget_items
  SET actual_cents = (
    SELECT COALESCE(SUM(amount_cents), 0)
    FROM budget_item_actual_entries
    WHERE budget_item_id = OLD.budget_item_id
  )
  WHERE id = OLD.budget_item_id;
END;

CREATE TRIGGER actual_entries_after_delete
AFTER DELETE ON budget_item_actual_entries
FOR EACH ROW
BEGIN
  UPDATE budget_items
  SET actual_cents = (
    SELECT COALESCE(SUM(amount_cents), 0)
    FROM budget_item_actual_entries
    WHERE budget_item_id = OLD.budget_item_id
  )
  WHERE id = OLD.budget_item_id;
END;