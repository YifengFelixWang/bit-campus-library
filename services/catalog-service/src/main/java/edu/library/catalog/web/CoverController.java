package edu.library.catalog.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 封面图片读取接口。
 *
 * 为什么不直接让前端访问 /covers/xxx.png：
 *   那依赖 Nginx / dev-server 的静态路由配置，换环境就失效（本地就踩过这个坑）。
 *   由服务自己读文件并返回，前端只需要一个 /api 路径，任何环境都能用。
 */
@RestController
@RequestMapping("/api/catalog/covers")
public class CoverController {

    private final Path coverDir;

    public CoverController(@Value("${catalog.upload.cover-dir:web/covers}") String coverDir) {
        this.coverDir = Paths.get(coverDir).toAbsolutePath().normalize();
    }

    @GetMapping("/{file}")
    public ResponseEntity<Resource> cover(@PathVariable String file) {
        // 只允许字母数字与常见扩展名，避免路径穿越
        if (!file.matches("[A-Za-z0-9_-]+\\.(png|jpg|jpeg|webp)")) {
            return ResponseEntity.badRequest().build();
        }
        Path target = coverDir.resolve(file).normalize();
        if (!target.startsWith(coverDir) || !Files.isReadable(target)) {
            return ResponseEntity.notFound().build();
        }
        MediaType type = file.toLowerCase().endsWith(".png") ? MediaType.IMAGE_PNG
                : file.toLowerCase().endsWith(".webp") ? MediaType.parseMediaType("image/webp")
                : MediaType.IMAGE_JPEG;
        return ResponseEntity.ok()
                .contentType(type)
                .header("Cache-Control", "no-cache")
                .body(new FileSystemResource(target));
    }
}
