package github.hacimertgokhan.denis.cli;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/** Minimal blocking JSON-mode connection used by the CLI to talk to a running server. */
final class RemoteClient implements AutoCloseable {
    private final Socket socket;
    private final BufferedReader in;
    private final Writer out;

    private RemoteClient(Socket socket) throws IOException {
        this.socket = socket;
        this.in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        this.out = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
    }

    static RemoteClient connect(String host, int port, int timeoutMillis) throws IOException {
        Socket socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), timeoutMillis);
        socket.setSoTimeout(Math.max(timeoutMillis, 600_000));
        RemoteClient client = new RemoteClient(socket);
        JSONObject mode = client.call("MODE json");
        if (!mode.optBoolean("ok")) {
            client.close();
            throw new IOException("server refused MODE json");
        }
        return client;
    }

    /** True when something answers PING on host:port. */
    static boolean isServerRunning(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 500);
            socket.setSoTimeout(1000);
            Writer w = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
            w.write("PING\n");
            w.flush();
            String line = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)).readLine();
            return line != null && line.contains("PONG");
        } catch (IOException e) {
            return false;
        }
    }

    JSONObject call(String line) throws IOException {
        String reply = callRaw(line);
        try {
            return new JSONObject(reply);
        } catch (RuntimeException e) {
            return new JSONObject().put("ok", false).put("error", reply);
        }
    }

    String callRaw(String line) throws IOException {
        out.write(line);
        out.write('\n');
        out.flush();
        String reply = in.readLine();
        if (reply == null) {
            throw new IOException("connection closed by server");
        }
        return reply;
    }

    void login(String group, String password) throws IOException {
        JSONObject reply = call("LIN " + group + " " + password);
        if (!reply.optBoolean("ok")) {
            throw new IOException(reply.optString("error", "login failed"));
        }
    }

    @Override
    public void close() {
        try {
            out.write("EXIT\n");
            out.flush();
        } catch (IOException ignored) {
            // closing anyway
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // closing anyway
        }
    }
}
