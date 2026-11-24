BEGIN;
INSERT INTO catalog.category (category_id, category_name, updated_at, deleted)
SELECT 3, '营养健康', LOCALTIMESTAMP, FALSE
WHERE NOT EXISTS (SELECT 1 FROM catalog.category WHERE category_id = 3);

INSERT INTO catalog.book (book_id, isbn, title, category_id, updated_at, deleted)
SELECT 6, 'LOCAL-0006', 'Computer Systems: A Programmer''s Perspective', 2, LOCALTIMESTAMP, FALSE
WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 6);

INSERT INTO catalog.book (book_id, isbn, title, category_id, updated_at, deleted)
SELECT 18, 'LOCAL-0018', '高等营养全书', 3, LOCALTIMESTAMP, FALSE
WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 18);

INSERT INTO catalog.author (author_id, author_name, updated_at, deleted)
SELECT 5, 'Randal E. Bryant', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 5);
INSERT INTO catalog.author (author_id, author_name, updated_at, deleted)
SELECT 6, 'David R. O''Hallaron', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 6);
INSERT INTO catalog.author (author_id, author_name, updated_at, deleted)
SELECT 7, 'Saren S. Gropper', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 7);
INSERT INTO catalog.author (author_id, author_name, updated_at, deleted)
SELECT 8, 'Jack L. Smith', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 8);

INSERT INTO catalog.book_author (book_id, author_id)
SELECT 6, 5 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 6 AND author_id = 5);
INSERT INTO catalog.book_author (book_id, author_id)
SELECT 6, 6 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 6 AND author_id = 6);
INSERT INTO catalog.book_author (book_id, author_id)
SELECT 18, 7 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 18 AND author_id = 7);
INSERT INTO catalog.book_author (book_id, author_id)
SELECT 18, 8 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 18 AND author_id = 8);

INSERT INTO catalog.media (media_id, book_id, file_url, updated_at, deleted)
SELECT 6, 6, 'covers/book-6.jpg', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE book_id = 6);
INSERT INTO catalog.media (media_id, book_id, file_url, updated_at, deleted)
SELECT 18, 18, 'covers/book-18.jpg', LOCALTIMESTAMP, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE book_id = 18);

INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at)
SELECT 5, 6, 'LIB-0006-01', 'AVAILABLE', LOCALTIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE copy_id = 5);
INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at)
SELECT 6, 6, 'LIB-0006-02', 'AVAILABLE', LOCALTIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE copy_id = 6);
INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at)
SELECT 7, 18, 'LIB-0018-01', 'AVAILABLE', LOCALTIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE copy_id = 7);
INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at)
SELECT 8, 18, 'LIB-0018-02', 'AVAILABLE', LOCALTIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE copy_id = 8);
COMMIT;
