package github.hacimertgokhan.drivers.connection;

import github.hacimertgokhan.drivers.exceptions.DenisException;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * One TCP session with a Denis server. Every request line is answered by
 * exactly one reply line; the connection switches the server to
 * {@code MODE json} right after connecting so replies can be parsed reliably.
 */
public class ConnectionManager implements AutoCloseable {
    private final String host;
    private final int port;
    private final int timeoutMillis;
    private Socket socket;
    private BufferedReader reader;
    private PrintWriter writer;
    private String authToken;

    public ConnectionManager(String host, int port) {
        this(host, port, 10_000);
    }

    public ConnectionManager(String host, int port, int timeoutMillis) {
        this.host = host;
        this.port = port;
        this.timeoutMillis = timeoutMillis;
    }

    public void connect() throws IOException {
        socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), timeoutMillis);
        socket.setSoTimeout(timeoutMillis);
        socket.setTcpNoDelay(true);
        reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8);
        JSONObject mode = send("MODE json");
        if (!mode.optBoolean("ok")) {
            throw new DenisException("Server refused MODE json: " + mode);
        }
    }

    public void disconnect() throws IOException {
        if (socket != null && !socket.isClosed()) {
            try {
                if (writer != null) {
                    writer.println("EXIT");
                }
            } finally {
                socket.close();
            }
        }
    }

    @Override
    public void close() throws IOException {
        disconnect();
    }

    public void setAuthToken(String token) {
        this.authToken = token;
    }

    public String getAuthToken() {
        return authToken;
    }

    /** Send one command line and parse the single JSON reply line. */
    public synchronized JSONObject send(String command) throws IOException {
        validateConnection();
        if (command.indexOf('\n') >= 0 || command.indexOf('\r') >= 0) {
            throw new DenisException("Command must be a single line");
        }
        writer.println(command);
        String line = reader.readLine();
        if (line == null) {
            throw new DenisException("Connection closed by server");
        }
        try {
            return new JSONObject(line);
        } catch (JSONException e) {
            throw new DenisException("Unexpected reply from server: " + line);
        }
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
