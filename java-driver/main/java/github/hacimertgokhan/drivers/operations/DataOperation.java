package github.hacimertgokhan.drivers.operations;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.io.IOException;

public class DataOperation {
    private final ConnectionManager connectionManager;

    public DataOperation(ConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
    }

    public String get(String key) throws IOException {
        validateAuth();
        String command = String.format("GET %s %s", connectionManager.getAuthToken(), key);
        connectionManager.sendCommand(command);
        return connectionManager.readResponse();
    }

    public void set(String key, String value) throws IOException {
        validateAuth();
        String command = String.format("SET %s %s %s", connectionManager.getAuthToken(), key, value);
        connectionManager.sendCommand(command);
        validateResponse("Set");
    }

    public void delete(String key) throws IOException {
        validateAuth();
        String command = String.format("DELETE %s %s", connectionManager.getAuthToken(), key);
        connectionManager.sendCommand(command);
        validateResponse("Delete");
    }

    public void update(String key, String value) throws IOException {
        validateAuth();
        String command = String.format("UPDATE %s %s %s", connectionManager.getAuthToken(), key, value);
        connectionManager.sendCommand(command);
        validateResponse("Update");
    }

    private void validateAuth() {
        if (connectionManager.getAuthToken() == null) {
            throw new DenisException("Not authenticated. Please call authenticate() first.");
        }
    }

    private void validateResponse(String operation) throws IOException {
        String response = connectionManager.readResponse();
        if (!response.equals("OK")) {
            throw new DenisException(operation + " operation failed: " + response);
        }
    }
}