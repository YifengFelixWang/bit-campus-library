package edu.library.catalog.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.UUID;

/**
 * 统一异常出口。
 * 顺带说明：数据库抛出的 INVALID_SORT_FIELD / INVALID_ARGUMENT（存储过程里 RAISE 的），
 * 在这里被识别成 400，而不是 500——否则前端会把「参数不合法」当成「服务挂了」。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiResponse<Void>> handleApi(ApiException e, HttpServletRequest req) {
        return ResponseEntity.status(e.getStatus())
                .body(ApiResponse.fail(e.getCode(), e.getMessage(), requestId(req)));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissing(MissingServletRequestParameterException e,
                                                           HttpServletRequest req) {
        return ResponseEntity.badRequest()
                .body(ApiResponse.fail("INVALID_ARGUMENT", "缺少参数：" + e.getParameterName(), requestId(req)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleOther(Exception e, HttpServletRequest req) {
        String msg = e.getMessage() == null ? "" : e.getMessage();

        // 存储过程/数据库把错误码塞在异常信息里，这里做一次识别，避免全部落到 500
        if (msg.contains("INVALID_SORT_FIELD")) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.fail("INVALID_SORT_FIELD", "不支持的排序字段", requestId(req)));
        }
        if (msg.contains("INVALID_ARGUMENT")) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.fail("INVALID_ARGUMENT", "参数不合法", requestId(req)));
        }
        return ResponseEntity.status(503)
                .body(ApiResponse.fail("DATABASE_UNAVAILABLE", "服务暂时不可用，请稍后重试", requestId(req)));
    }

    private String requestId(HttpServletRequest req) {
        String id = req.getHeader("X-Request-Id");
        return id != null && !id.isBlank() ? id : UUID.randomUUID().toString();
    }
}
