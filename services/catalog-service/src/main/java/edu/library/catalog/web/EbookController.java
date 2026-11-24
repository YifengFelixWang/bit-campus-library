package edu.library.catalog.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 电子书附件：查询、下载、上传。支持 PDF 与 EPUB。
 *
 * 文件放在宿主机目录（云端挂 /data/ebooks，与 Nginx 的 /files 指向同一块盘），库里只存元数据。
 * 下载走服务自己流式返回，不依赖 Nginx 的静态路由，换环境也不会 404。
 * 上传由 AuthFilter 拦成「馆员及以上」，读者与匿名只能查和下载。
 */
@RestController
@RequestMapping("/api/catalog/books")
public class EbookController {

    private static final long MAX_BYTES = 300L * 1024 * 1024;
    private static final byte[] PDF_MAGIC = "%PDF-".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};

    private final JdbcTemplate jdbc;
    private final Path ebookDir;

    public EbookController(JdbcTemplate jdbc,
                           @Value("${catalog.upload.ebook-dir:web/ebooks}") String ebookDir) {
        this.jdbc = jdbc;
        this.ebookDir = Paths.get(ebookDir).toAbsolutePath().normalize();
    }

    /** 有没有电子书、是什么格式；前端据此决定按钮文案或「后端暂无电子书」。 */
    @GetMapping("/{id}/ebook")
    public Map<String, Object> meta(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select file_name, size_bytes, updated_at from catalog.ebook where book_id = ? and deleted = false", id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bookId", id);
        if (rows.isEmpty()) {
            out.put("available", false);
            return out;
        }
        Map<String, Object> row = rows.get(0);
        String name = String.valueOf(row.get("file_name"));
        out.put("available", true);
        out.put("fileName", name);
        out.put("format", formatOf(name));
        out.put("sizeBytes", row.get("size_bytes"));
        out.put("updatedAt", row.get("updated_at"));
        out.put("url", "/api/catalog/books/" + id + "/ebook/file");
        return out;
    }

    /** 所有人可下载；文件名统一 book-<id>.<ext>，避免中文名在不同浏览器上乱码。 */
    @GetMapping("/{id}/ebook/file")
    public ResponseEntity<Resource> download(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select file_name from catalog.ebook where book_id = ? and deleted = false", id);
        if (rows.isEmpty()) return ResponseEntity.notFound().build();
        String name = String.valueOf(rows.get(0).get("file_name"));
        Path target = ebookDir.resolve(name).normalize();
        if (!target.startsWith(ebookDir) || !Files.isReadable(target)) return ResponseEntity.notFound().build();
        String format = formatOf(name);
        MediaType type = "epub".equals(format)
                ? MediaType.parseMediaType("application/epub+zip")
                : MediaType.APPLICATION_PDF;
        return ResponseEntity.ok()
                .contentType(type)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"book-" + id + "." + ("epub".equals(format) ? "epub" : "pdf") + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(new FileSystemResource(target));
    }

    /** 上传或替换电子书：只收 PDF / EPUB，校验文件头，落盘后 upsert 元数据。 */
    @PostMapping(value = "/{id}/ebook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@PathVariable long id,
                                                      @RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("code", "EMPTY_FILE", "message", "没有收到文件"));
        }
        if (file.getSize() > MAX_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("code", "FILE_TOO_LARGE", "message", "文件超过 300 MB"));
        }
        Integer exists = jdbc.queryForObject(
                "select count(*) from catalog.book where book_id = ? and deleted = false", Integer.class, id);
        if (exists == null || exists == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("code", "BOOK_NOT_FOUND", "message", "图书不存在"));
        }

        String ext = extensionOf(file.getOriginalFilename());
        byte[] magic = new byte[5];
        int read;
        try (InputStream in = file.getInputStream()) {
            read = in.read(magic);
        }
        boolean isPdf = read >= 5 && startsWith(magic, PDF_MAGIC);
        boolean isEpub = read >= 4 && startsWith(magic, ZIP_MAGIC);
        if (!(isPdf || isEpub)) {
            return ResponseEntity.badRequest().body(Map.of("code", "NOT_EBOOK", "message", "只支持 PDF 或 EPUB 文件"));
        }
        if (ext == null) ext = isPdf ? "pdf" : "epub";

        Files.createDirectories(ebookDir);
        String name = "ebook-" + id + "." + ext;
        Path target = ebookDir.resolve(name).normalize();
        if (!target.startsWith(ebookDir)) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_PATH", "message", "文件名不合法"));
        }
        removeOtherFormat(id, ext);
        file.transferTo(target);

        Long userId = edu.library.catalog.config.RoleContext.userId();
        int updated = jdbc.update("""
                update catalog.ebook set file_name=?, size_bytes=?, uploaded_by=?, updated_at=localtimestamp, deleted=false
                 where book_id=?
                """, name, file.getSize(), userId, id);
        if (updated == 0) {
            jdbc.update("""
                    insert into catalog.ebook(book_id, file_name, size_bytes, uploaded_by, updated_at, deleted)
                    values(?,?,?,?,localtimestamp,false)
                    """, id, name, file.getSize(), userId);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bookId", id);
        out.put("available", true);
        out.put("fileName", name);
        out.put("format", ext);
        out.put("sizeBytes", file.getSize());
        out.put("url", "/api/catalog/books/" + id + "/ebook/file");
        return ResponseEntity.ok(out);
    }

    /** 替换时若换了格式，旧文件要清掉，不然目录里会留下孤儿文件。 */
    private void removeOtherFormat(long id, String keepExt) {
        for (String ext : new String[]{"pdf", "epub"}) {
            if (ext.equals(keepExt)) continue;
            try {
                Files.deleteIfExists(ebookDir.resolve("ebook-" + id + "." + ext));
            } catch (IOException ignored) {
                // 删不掉不影响本次上传
            }
        }
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        if (data.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    private static String extensionOf(String fileName) {
        String name = fileName == null ? "" : fileName.toLowerCase();
        if (name.endsWith(".pdf")) return "pdf";
        if (name.endsWith(".epub")) return "epub";
        return null;
    }

    private static String formatOf(String fileName) {
        String name = fileName == null ? "" : fileName.toLowerCase();
        return name.endsWith(".epub") ? "epub" : "pdf";
    }
}
