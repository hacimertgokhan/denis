package github.hacimertgokhan.drivers;


import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.operations.AuthOperation;
import github.hacimertgokhan.drivers.operations.DataOperation;

import java.io.IOException;

public class DenisClient implements AutoCloseable {
    private final ConnectionManager connectionManager;
    private final AuthOperation authOperation;
    private final DataOperation dataOperation;

    public DenisClient(String host) {
        this.connectionManager = new ConnectionManager(host, 5142);
        this.authOperation = new AuthOperation(connectionManager);
        this.dataOperation = new DataOperation(connectionManager);
    }

    public void connect() throws IOException {
        connectionManager.connect();
    }

    public String authenticate(String username, String password) throws IOException {
        return authOperation.authenticate(username, password);
    }

    public String get(String key) throws IOException {
        return dataOperation.get(key);
    }

    public void set(String key, String value) throws IOException {
        dataOperation.set(key, value);
    }

    public void delete(String key) throws IOException {
        dataOperation.delete(key);
    }

    public void update(String key, String value) throws IOException {
        dataOperation.update(key, value);
    }

    @Override
    public void close() throws Exception {
        connectionManager.disconnect();
    }
}