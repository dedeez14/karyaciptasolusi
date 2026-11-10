-- =============================================================================
-- Database layer security (idempotent). Applied after every migration.
-- :app_role is replaced with the runtime (least privilege) role name.
-- =============================================================================

-- L1. Least privilege: runtime role gets DML only, never DDL / ownership
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :app_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :app_role;
REVOKE ALL ON TABLE "_prisma_migrations" FROM :app_role;

-- L2. Audit & activity trails are append-only for the application
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM :app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE activity_logs FROM :app_role;

CREATE OR REPLACE FUNCTION kcs_block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION kcs_block_modification();

-- L3. Accounting integrity: posted journals must balance and cannot be edited
DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_journal_balanced
    CHECK (status <> 'POSTED' OR "totalDebit" = "totalCredit");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_journal_line_amount
    CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION kcs_protect_posted_journal() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    -- only allowed transition for a posted journal is voiding it
    IF TG_OP = 'DELETE' OR NEW.status <> 'VOID' OR NEW."totalDebit" <> OLD."totalDebit"
       OR NEW."totalCredit" <> OLD."totalCredit" OR NEW.date <> OLD.date THEN
      RAISE EXCEPTION 'Posted journal % cannot be modified; void it instead', OLD.number
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF OLD.status = 'VOID' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Voided journal % cannot be modified', OLD.number USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_protect ON journal_entries;
CREATE TRIGGER trg_journal_protect BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION kcs_protect_posted_journal();

-- L4. Value checks
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payment_amount CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payment_allocations ADD CONSTRAINT chk_allocation_amount CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE taxes ADD CONSTRAINT chk_tax_rate CHECK (rate >= 0 AND rate <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE stored_files ADD CONSTRAINT chk_file_size CHECK (size >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_dates CHECK ("endDate" >= "startDate");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- L5. Fast search on frequently filtered text columns
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_files_name_trgm ON stored_files USING gin (name gin_trgm_ops);
