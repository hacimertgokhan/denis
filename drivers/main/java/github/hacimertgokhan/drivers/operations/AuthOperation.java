package github.hacimertgokhan.drivers.operations;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.io.IOException;

public class AuthOperation {
    private final ConnectionManager connectionManager;

    public AuthOperation(ConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
    }

    public String authenticate(String username, String password) throws IOException {
        connectionManager.validateConnection();
        String command = String.format("AUTH %s %s", username, password);
        connectionManager.sendCommand(command);
        
        String response = connectionManager.readResponse();
        if (response.startsWith("SUCCESS")) {
            String token = response.split(" ")[1];
            connectionManager.setAuthToken(token);
            return token;
        }
        throw new DenisException("Authentication failed: " + response);
    }
}