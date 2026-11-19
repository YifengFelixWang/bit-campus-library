package edu.library.catalog.common;

/** 业务异常：抛出后由 GlobalExceptionHandler 统一转成契约的 {code,message,requestId} */
public class ApiException extends RuntimeException {

    private final String code;
    private final int status;

    public ApiException(String code, String message, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public int getStatus() {
        return status;
    }
}
