package github.hacimertgokhan.drivers.connection;

import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.io.*;
import java.net.Socket;

public class ConnectionManager {
    private final String host;
    private final int port;
    private Socket socket;
    private BufferedReader reader;
    private PrintWriter writer;
    private String authToken;

    public ConnectionManager(String host, int port) {
        this.host = host;
        this.port = port;
    }

    public void connect() throws IOException {
        socket = new Socket(host, port);
        reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
        writer = new PrintWriter(socket.getOutputStream(), true);
    }

    public void disconnect() throws IOException {
        if (socket != null && !socket.isClosed()) {
            socket.close();
        }
    }

    public void setAuthToken(String token) {
        this.authToken = token;
    }

    public String getAuthToken() {
        return authToken;
    }

    public void sendCommand(String command) {
        writer.println(command);
    }

    public String readResponse() throws IOException {
        return reader.readLine();
    }

    public boolean isConnected() {
        return socket != null && !socket.isClosed() && socket.isConnected();
    }

    public void validateConnection() {
        if (!isConnected()) {
            throw new DenisException("Not connected to server");
        }
    }
}