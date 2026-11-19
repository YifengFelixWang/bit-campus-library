-- Run on D's library database as schema owner. Existing account and loan rows are preserved.
BEGIN;
ALTER TABLE catalog.book ADD COLUMN IF NOT EXISTS publisher VARCHAR(100);
ALTER TABLE catalog.book ADD COLUMN IF NOT EXISTS publish_year INTEGER;
ALTER TABLE catalog.book ADD COLUMN IF NOT EXISTS summary VARCHAR(1000);
ALTER TABLE catalog.book ADD COLUMN IF NOT EXISTS total_copies INTEGER;
UPDATE catalog.book b SET total_copies = (SELECT count(*) FROM loan.book_copy c WHERE c.book_id=b.book_id)
 WHERE total_copies IS NULL;
ALTER TABLE catalog.book ALTER COLUMN total_copies SET DEFAULT 0;
ALTER TABLE catalog.book ALTER COLUMN total_copies SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_book_updated ON catalog.book(updated_at, book_id);
CREATE INDEX IF NOT EXISTS idx_category_updated ON catalog.category(updated_at, category_id);
COMMIT;
