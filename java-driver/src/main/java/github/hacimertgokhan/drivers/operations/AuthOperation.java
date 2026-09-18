package github.hacimertgokhan.drivers.operations;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import org.json.JSONObject;

import java.io.IOException;

/** {@code LIN} (group login) and {@code AUTH} (project selection). */
public class AuthOperation {
    private final ConnectionManager connectionManager;

    public AuthOperation(ConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
    }

    /** Log in with a group from {@code denis.toml}. */
    public void login(String group, String password) throws IOException {
        JSONObject reply = connectionManager.send(String.format("LIN %s %s", group, password));
        if (!reply.optBoolean("ok")) {
            throw new DenisException("Login failed: " + reply.optString("error", reply.toString()));
        }
    }

    /** Select an existing project by token. */
    public void authenticate(String token) throws IOException {
        JSONObject reply = connectionManager.send("AUTH " + token);
        if (!reply.optBoolean("ok")) {
            throw new DenisException("Authentication failed: " + reply.optString("error", reply.toString()));
        }
        connectionManager.setAuthToken(token);
    }

    /** Create a new project ({@code AUTH CREATE}) and select it. */
    public String createProject() throws IOException {
        JSONObject reply = connectionManager.send("AUTH CREATE");
        if (!reply.optBoolean("ok") || !reply.has("token")) {
            throw new DenisException("Project could not be created: " + reply.optString("error", reply.toString()));
        }
        String token = reply.getString("token");
        authenticate(token);
        return token;
    }
}
