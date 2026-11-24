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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 电子书（PDF）附件：查询、下载、上传。
 *
 * 文件放在宿主机目录（云端挂 /data/ebooks，与 Nginx 的 /files 指向同一块盘），库里只存元数据。
 * 下载走服务自己流式返回，不依赖 Nginx 的静态路由，换环境也不会 404。
 * 上传由 AuthFilter 拦成「馆员及以上」，读者与匿名只能查和下载。
 */
@RestController
@RequestMapping("/api/catalog/books")
public class EbookController {

    private static final long MAX_BYTES = 80L * 1024 * 1024;

    private final JdbcTemplate jdbc;
    private final Path ebookDir;

    public EbookController(JdbcTemplate jdbc,
                           @Value("${catalog.upload.ebook-dir:web/ebooks}") String ebookDir) {
        this.jdbc = jdbc;
        this.ebookDir = Paths.get(ebookDir).toAbsolutePath().normalize();
    }

    /** 有没有电子书；前端据此决定显示「下载」还是「后端无 PDF 版」。 */
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
        out.put("available", true);
        out.put("fileName", row.get("file_name"));
        out.put("sizeBytes", row.get("size_bytes"));
        out.put("updatedAt", row.get("updated_at"));
        out.put("url", "/api/catalog/books/" + id + "/ebook/file");
        return out;
    }

    /** 所有人可下载；文件名固定为 book-<id>.pdf，避免中文名在不同浏览器上乱码。 */
    @GetMapping("/{id}/ebook/file")
    public ResponseEntity<Resource> download(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select file_name from catalog.ebook where book_id = ? and deleted = false", id);
        if (rows.isEmpty()) return ResponseEntity.notFound().build();
        String name = String.valueOf(rows.get(0).get("file_name"));
        Path target = ebookDir.resolve(name).normalize();
        if (!target.startsWith(ebookDir) || !Files.isReadable(target)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"book-" + id + ".pdf\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(new FileSystemResource(target));
    }

    /** 上传或替换电子书：只收 PDF，校验文件头，落盘后 upsert 元数据。 */
    @PostMapping(value = "/{id}/ebook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@PathVariable long id,
                                                      @RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("code", "EMPTY_FILE", "message", "没有收到文件"));
        }
        if (file.getSize() > MAX_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("code", "FILE_TOO_LARGE", "message", "文件超过 80 MB"));
        }
        Integer exists = jdbc.queryForObject(
                "select count(*) from catalog.book where book_id = ? and deleted = false", Integer.class, id);
        if (exists == null || exists == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("code", "BOOK_NOT_FOUND", "message", "图书不存在"));
        }
        byte[] head = new byte[5];
        try (InputStream in = file.getInputStream()) {
            if (in.read(head) < 5 || !"%PDF-".equals(new String(head, java.nio.charset.StandardCharsets.US_ASCII))) {
                return ResponseEntity.badRequest().body(Map.of("code", "NOT_PDF", "message", "只支持 PDF 文件"));
            }
        }

        Files.createDirectories(ebookDir);
        String name = "ebook-" + id + ".pdf";
        Path target = ebookDir.resolve(name).normalize();
        if (!target.startsWith(ebookDir)) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_PATH", "message", "文件名不合法"));
        }
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
        out.put("sizeBytes", file.getSize());
        out.put("url", "/api/catalog/books/" + id + "/ebook/file");
        return ResponseEntity.ok(out);
    }
}
