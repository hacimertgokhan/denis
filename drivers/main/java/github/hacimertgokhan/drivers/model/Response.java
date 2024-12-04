package github.hacimertgokhan.drivers.model;

public class Response {
    private final boolean success;
    private final String message;
    private final String data;

    public Response(boolean success, String message, String data) {
        this.success = success;
        this.message = message;
        this.data = data;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getMessage() {
        return message;
    }

    public String getData() {
        return data;
    }
}