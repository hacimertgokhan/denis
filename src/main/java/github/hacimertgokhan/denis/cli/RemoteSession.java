package github.hacimertgokhan.denis.cli;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * A CLI-side connection to a running server. Always speaks {@code MODE json}
 * so every command is answered by exactly one line the CLI can render.
 */
class RemoteSession implements AutoCloseable {
    private final Socket socket;
    private final BufferedReader in;
    private final PrintWriter out;
    private String token;

    RemoteSession(String host, int port, int timeoutMillis) throws IOException {
        socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), timeoutMillis);
        socket.setSoTimeout(timeoutMillis);
        socket.setTcpNoDelay(true);
        in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
        JSONObject mode = send("MODE json");
        if (!mode.optBoolean("ok")) {
            throw new IOException("server refused MODE json: " + mode);
        }
    }

    JSONObject send(String line) throws IOException {
        out.println(line);
        String reply = in.readLine();
        if (reply == null) {
            throw new IOException("connection closed by server");
        }
        try {
            return new JSONObject(reply);
        } catch (JSONException e) {
            return new JSONObject().put("ok", false).put("error", "unparseable reply: " + reply);
        }
    }

    /** {@code LIN}; throws with the server's message on failure. */
    void login(String group, String password) throws IOException {
        JSONObject reply = send("LIN " + group + " " + password);
        if (!reply.optBoolean("ok")) {
            throw new IOException(reply.optString("error", "login failed"));
        }
    }

    /** {@code AUTH <token>} or, with {@code null}, {@code AUTH CREATE}. */
    String auth(String token) throws IOException {
        if (token == null) {
            JSONObject created = send("AUTH CREATE");
            if (!created.optBoolean("ok")) {
                throw new IOException(created.optString("error", "AUTH CREATE failed"));
            }
            token = created.getString("token");
        }
        JSONObject reply = send("AUTH " + token);
        if (!reply.optBoolean("ok")) {
            throw new IOException(reply.optString("error", "auth failed"));
        }
        this.token = token;
        return token;
    }

    String token() {
        return token;
    }

    @Override
    public void close() {
        try {
            out.println("EXIT");
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing anyway
            }
        }
    }
}
