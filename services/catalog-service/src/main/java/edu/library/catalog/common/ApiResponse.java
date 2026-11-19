package edu.library.catalog.common;

/** 契约统一响应包装：{ code, message, data, requestId } */
public class ApiResponse<T> {

    private final String code;
    private final String message;
    private final T data;
    private final String requestId;

    private ApiResponse(String code, String message, T data, String requestId) {
        this.code = code;
        this.message = message;
        this.data = data;
        this.requestId = requestId;
    }

    public static <T> ApiResponse<T> ok(T data, String requestId) {
        return new ApiResponse<>("OK", "", data, requestId);
    }

    public static <T> ApiResponse<T> fail(String code, String message, String requestId) {
        return new ApiResponse<>(code, message, null, requestId);
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public T getData() {
        return data;
    }

    public String getRequestId() {
        return requestId;
    }
}
