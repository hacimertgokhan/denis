package github.hacimertgokhan.denis;

import database.Token;
import github.hacimertgokhan.Main;
import github.hacimertgokhan.denis.client.ClientStates;
import github.hacimertgokhan.denis.sections.group.Group;
import github.hacimertgokhan.denis.sql.SqlQueryEngine;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.pointers.Authories;
import github.hacimertgokhan.proto.ProtoDatabase;
import github.hacimertgokhan.readers.DenisProperties;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * One TCP client session. The wire protocol is line based:
 *
 * <pre>
 *   LIN &lt;group&gt; &lt;password&gt;          log in with a group from denis.toml
 *   AUTH CREATE | AUTH &lt;token&gt;      create / select a project (key namespace)
 *   MODE json | MODE text          response format for this connection (default: text)
 *   PING                           liveness check
 *   SET &lt;key&gt; &lt;value&gt; [-&amp;save] [-&amp;cache] [-&amp;protobuff]
 *   GET &lt;key&gt; [-&amp;from-cache | -&amp;from-protobuff] [-&amp;asa-json]
 *   DEL &lt;key&gt; [-&amp;cache] [-&amp;protobuff]
 *   UPDATE &lt;key&gt; &lt;value&gt;
 *   HEAVEN                         drop every key of the current project from the cache
 *   SQL ... / CREATE TABLE ... etc. (see SqlQueryEngine)
 *   EXIT
 * </pre>
 *
 * In {@code text} mode replies are the human readable lines Denis always had
 * ({@code [Info - date]: ...}, raw values for GET). In {@code json} mode every
 * reply is exactly one JSON object per line, {@code {"ok":true|false,...}},
 * which is what the client libraries use.
 */
public class DenisClient {
    static DenisProperties denisProperties = new DenisProperties();
    static boolean CLIENT_ACTIONS = denisProperties.getBoolean("send-client-actions", true);
    static DenisLogger DDBServer = new DenisLogger(Main.class);
    static JsonFile ddb = new JsonFile("ddb.json");
    static File storageDir = new File("storage");
    static final String DATABASE_FILE = "database.bin";

    private final ConcurrentHashMap<String, Authories> projects = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Any> store;
    private final DenisTerminal logTerminal;
    private String currentProjectToken = null;
    private List<String> accessList = new ArrayList<>();
    private ClientStates currentClientState = ClientStates.INITIAL;
    private boolean jsonMode = false;
    private boolean loggedIn = false;

    public ClientStates getCurrentClientState() {
        return currentClientState;
    }

    public void setCurrentClientState(ClientStates currentClientState) {
        this.currentClientState = currentClientState;
    }

    public class Login {
        private String group;
        private String password;
        private boolean logged;

        public Login(String group, String password) {
            this.group = group;
            this.password = password;
        }

        public Login() {}

        public boolean join(PrintWriter out) {
            if (!isLogged()) {
                Group group = new Group(this.group);
                if (group.isExists() && group.in(password)) {
                    setLogged(true);
                    accessList = group.getAccessList();
                    return true;
                }
                setLogged(false);
                return false;
            }
            return true;
        }

        public boolean isLogged() {
            return logged;
        }

        public String getGroup() {
            return group;
        }

        public String getPassword() {
            return password;
        }

        public void setGroup(String group) {
            this.group = group;
        }

        public void setLogged(boolean logged) {
            this.logged = logged;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }

    public DenisClient(Socket socket, ConcurrentHashMap<String, Any> store, DenisTerminal logTerminal) {
        this.store = store;
        this.logTerminal = logTerminal;
        if (!storageDir.exists() && storageDir.mkdir()) {
            DDBServer.info("Storage directory created.");
        }
        try {
            List<String> tokens = ddb.tokenList();
            if (tokens.isEmpty()) {
                DDBServer.debug("Token list is empty.");
            }
            for (String tkn : tokens) {
                registerProject(tkn, tkn);
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public DenisClient(Socket socket, ConcurrentHashMap<String, Any> store) {
        this(socket, store, null);
    }

    public void sendWelcomeMessage(PrintWriter out) {
        out.println(String.format("[Welcome - %s]: Welcome to Denis! Please authenticate using AUTH command.", new Date()));
    }

    private void registerProject(String token, String tokenKey) {
        projects.put(token, new Authories(token, tokenKey));
    }

    private boolean authenticateProject(String token) {
        if (projects.containsKey(token)) {
            currentProjectToken = token;
            return true;
        }
        return false;
    }

    /**
     * Bring the project's persisted keys into the cache after AUTH. Keys that are
     * already cached are left alone: the cache is shared by every connection of
     * the project, and wiping it here used to throw away what other clients had
     * just written.
     */
    private void loadStorageFromProtobuf(String token) {
        try {
            String prefix = getProjectPrefix();
            Token.TokenData tokenData = new ProtoDatabase(DATABASE_FILE).findToken(prefix);
            if (tokenData == null) {
                return;
            }
            int loaded = 0;
            for (Map.Entry<String, String> entry : tokenData.getKeyValuesMap().entrySet()) {
                String fullKey = entry.getKey().startsWith(prefix) ? entry.getKey() : prefix + entry.getKey();
                if (store.putIfAbsent(fullKey, new Any(entry.getValue())) == null) {
                    loaded++;
                }
            }
            DDBServer.info(String.format("Storage loaded from Protobuf for token %s (%d new keys)", token, loaded));
        } catch (IOException e) {
            DDBServer.error("Error loading from Protobuf: " + e.getMessage());
        }
    }

    private String getProjectPrefix() {
        return currentProjectToken != null ? currentProjectToken + ":" : null;
    }

    private static String stripPrefix(String key) {
        int i = key.indexOf(':');
        return i >= 0 ? key.substring(i + 1) : key;
    }

    // ------------------------------------------------------------------ replies

    public void clientLogg(int level, PrintWriter printWriter, String message) {
        if (jsonMode) {
            JSONObject json = new JSONObject();
            json.put("ok", level != 2);
            json.put(level == 2 ? "error" : "message", message);
            printWriter.println(json);
            return;
        }
        switch (level) {
            case 0 -> printWriter.println(String.format("[Info - %s]: %s", new Date(), message));
            case 1 -> printWriter.println(String.format("[Debug - %s]: %s", new Date(), message));
            case 2 -> printWriter.println(String.format("[Error - %s]: %s", new Date(), message));
            default -> throw new IllegalStateException("Unexpected value: " + level);
        }
    }

    private void ok(PrintWriter out, String message) {
        clientLogg(0, out, message);
    }

    private void error(PrintWriter out, String message) {
        clientLogg(2, out, message);
    }

    /** A value reply (GET): the raw value in text mode, {@code {"ok":true,"key":..,"data":..}} in json mode. */
    private void value(PrintWriter out, String key, Object data) {
        if (jsonMode) {
            JSONObject json = new JSONObject();
            json.put("ok", true);
            json.put("key", stripPrefix(key));
            json.put("data", data == null ? JSONObject.NULL : String.valueOf(data));
            out.println(json);
        } else {
            out.println(String.valueOf(data));
        }
    }

    private void notFound(PrintWriter out, String key) {
        if (jsonMode) {
            JSONObject json = new JSONObject();
            json.put("ok", false);
            json.put("key", stripPrefix(key));
            json.put("error", "not found");
            out.println(json);
        } else {
            out.println(String.format("err: %s not found in cache or protobuff", stripPrefix(key)));
        }
    }

    /** {@code GET -&asa-json} in text mode: a properly escaped JSON object. */
    private void valueAsJson(PrintWriter out, String key, Object data) {
        JSONObject json = new JSONObject();
        json.put("key", stripPrefix(key));
        json.put("data", data == null ? JSONObject.NULL : String.valueOf(data));
        if (jsonMode) {
            json.put("ok", true);
        }
        out.println(json);
    }

    private void usage(PrintWriter out, String usage) {
        if (jsonMode) {
            error(out, usage);
        } else {
            out.println(usage);
        }
    }

    // ------------------------------------------------------------------ session

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store, DenisTerminal logTerminal) {
        handleClient(clientSocket);
    }

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store) {
        handleClient(clientSocket);
    }

    public void handleClient(Socket clientSocket) {
        if (clientSocket == null || clientSocket.isClosed()) {
            return;
        }
        String peer = clientSocket.getInetAddress().getHostAddress();
        try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream(), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)) {
            String inputLine;
            while ((inputLine = in.readLine()) != null) {
                if (inputLine.isBlank()) {
                    continue;
                }
                if (CLIENT_ACTIONS) {
                    String action = String.format("[CLIENT] %s action: %s", peer, describe(inputLine));
                    if (logTerminal != null) {
                        logTerminal.writeLog(action);
                    }
                    DDBServer.info(action);
                }
                if (!handleLine(inputLine, out)) {
                    break;
                }
            }
        } catch (IOException e) {
            DDBServer.error("Error handling client: " + e.getMessage());
        }
    }

    /** Never echo credentials into the logs. */
    private static String describe(String line) {
        String[] parts = line.split(" ", 2);
        String command = parts[0].toUpperCase(Locale.ROOT);
        if (command.equals("LIN") || command.equals("AUTH")) {
            return command + " ***";
        }
        return line;
    }

    /** @return false when the connection should be closed. */
    boolean handleLine(String inputLine, PrintWriter out) {
        String[] parts = inputLine.trim().split(" ", 3);
        String command = parts[0].toUpperCase(Locale.ROOT);

        switch (command) {
            case "EXIT", "QUIT" -> {
                ok(out, "Bye.");
                return false;
            }
            case "PING" -> {
                if (jsonMode) {
                    ok(out, "PONG");
                } else {
                    out.println("PONG");
                }
                return true;
            }
            case "MODE" -> {
                String mode = parts.length > 1 ? parts[1].toLowerCase(Locale.ROOT) : "";
                switch (mode) {
                    case "json" -> {
                        jsonMode = true;
                        ok(out, "mode json");
                    }
                    case "text" -> {
                        jsonMode = false;
                        ok(out, "mode text");
                    }
                    default -> usage(out, "USAGE: MODE <json|text>");
                }
                return true;
            }
            default -> {
                // fall through to the authenticated flow below
            }
        }

        if (!loggedIn) {
            if (!command.equals("LIN")) {
                error(out, "Please login first using LIN command");
                return true;
            }
            if (parts.length < 3) {
                usage(out, "USAGE: LIN <Group> <Password>");
                return true;
            }
            loggedIn = new Login(parts[1], parts[2]).join(out);
            if (loggedIn) {
                currentClientState = ClientStates.LOGGED_IN;
                ok(out, "Logged in to group: " + parts[1]);
            } else {
                error(out, "Login failed: unknown group or wrong password");
            }
            return true;
        }

        if (command.equals("AUTH")) {
            if (parts.length < 2) {
                usage(out, "USAGE: AUTH <CREATE|token>");
                return true;
            }
            if (parts[1].equalsIgnoreCase("CREATE")) {
                String newToken = new CreateSecureToken().getToken();
                registerProject(newToken, newToken);
                try {
                    ddb.appendToArray("tokens", newToken);
                    if (jsonMode) {
                        JSONObject json = new JSONObject();
                        json.put("ok", true);
                        json.put("message", "Project created");
                        json.put("token", newToken);
                        out.println(json);
                    } else {
                        ok(out, "Project created! Token: " + newToken);
                    }
                } catch (IOException e) {
                    DDBServer.error("Error saving new token: " + e.getMessage());
                    error(out, "Could not create project");
                }
                return true;
            }
            String token = parts[1];
            if (authenticateProject(token)) {
                loadStorageFromProtobuf(token);
                currentClientState = ClientStates.AUTHENTICATED;
                ok(out, "Authenticated to project: " + token);
            } else {
                error(out, "Cannot auth with: " + token);
            }
            return true;
        }

        if (currentProjectToken == null) {
            error(out, "Please authenticate first using AUTH command");
            return true;
        }

        if (SqlQueryEngine.isSqlCommand(inputLine)) {
            String result = new SqlQueryEngine(store, currentProjectToken).execute(inputLine);
            if (jsonMode) {
                JSONObject json = new JSONObject();
                json.put("ok", !result.startsWith("ERROR"));
                json.put("data", result);
                out.println(json);
            } else {
                out.println(result);
            }
            return true;
        }

        String prefix = getProjectPrefix();
        String key = parts.length > 1 ? prefix + parts[1] : null;

        switch (command) {
            case "HEAVEN" -> {
                store.entrySet().removeIf(entry -> entry.getKey().startsWith(prefix));
                ok(out, "Ok.");
            }
            case "GET" -> handleGet(out, key, parts);
            case "SET" -> handleSet(out, key, parts);
            case "DEL" -> handleDel(out, key, parts);
            case "UPDATE" -> {
                if (parts.length >= 3) {
                    store.put(key, new Any(parts[2]));
                    ok(out, "Ok.");
                } else {
                    usage(out, "USAGE: UPDATE <key> <newValue>");
                }
            }
            default -> error(out, "Unknown command: " + command);
        }
        return true;
    }

    private static boolean hasFlag(String[] flags, String flag) {
        return Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase(flag));
    }

    private static boolean isFlag(String word) {
        return word.startsWith("-&");
    }

    private void handleGet(PrintWriter out, String key, String[] parts) {
        if (parts.length < 2) {
            usage(out, "USAGE: GET <key> [-&from-cache,-&from-protobuff] [-&asa-json]");
            return;
        }
        String[] flags = parts.length > 2 ? parts[2].split(" ") : new String[0];
        boolean fromCache = hasFlag(flags, "-&from-cache");
        boolean asJson = hasFlag(flags, "-&asa-json");
        boolean fromProtoBuff = hasFlag(flags, "-&from-protobuff");

        Any cached = store.get(key);
        String persisted;
        try {
            persisted = new ProtoDatabase(DATABASE_FILE).getData(getProjectPrefix(), key);
        } catch (IOException e) {
            error(out, "Could not read protobuf storage: " + e.getMessage());
            return;
        }

        Object data;
        if (fromProtoBuff) {
            data = persisted != null ? persisted : (cached != null ? cached.getValue() : null);
        } else {
            // default and -&from-cache: cache first, then the protobuf file
            data = cached != null ? cached.getValue() : persisted;
        }

        if (data == null) {
            notFound(out, key);
        } else if (asJson && !fromCache) {
            valueAsJson(out, key, data);
        } else {
            value(out, key, data);
        }
    }

    private void handleSet(PrintWriter out, String key, String[] parts) {
        if (parts.length < 3) {
            usage(out, "USAGE: SET <key> <value> [-&save] [-&cache] [-&protobuff]");
            return;
        }
        // Flags come after the value and are not part of it.
        String[] words = parts[2].split(" ");
        String[] flags = Arrays.stream(words).filter(DenisClient::isFlag).toArray(String[]::new);
        String value = Arrays.stream(words).filter(w -> !isFlag(w)).collect(Collectors.joining(" "));
        boolean save = hasFlag(flags, "-&save");
        boolean cache = hasFlag(flags, "-&cache");
        boolean protobuff = hasFlag(flags, "-&protobuff");

        store.put(key, new Any(value));
        List<String> stored = new ArrayList<>();
        if (!save && !cache && !protobuff) {
            stored.add("Cache");
        } else {
            if (cache) {
                stored.add("Cache");
            }
            if (save || protobuff) {
                try {
                    new ProtoDatabase(DATABASE_FILE).setData(getProjectPrefix(), key, new Any(value));
                    stored.add("Protobuf");
                } catch (IOException e) {
                    error(out, "Could not write protobuf storage: " + e.getMessage());
                    return;
                }
            }
        }
        ok(out, "Ok (" + String.join(", ", stored) + ")");
    }

    private void handleDel(PrintWriter out, String key, String[] parts) {
        if (parts.length < 2) {
            usage(out, "USAGE: DEL <key> [-&cache] [-&protobuff]");
            return;
        }
        String[] flags = parts.length > 2 ? parts[2].split(" ") : new String[0];
        boolean cacheDel = hasFlag(flags, "-&cache");
        boolean protoDel = hasFlag(flags, "-&protobuff");
        try {
            if (cacheDel) {
                store.remove(key);
                ok(out, "Ok (Cache).");
            } else if (protoDel) {
                new ProtoDatabase(DATABASE_FILE).deleteData(getProjectPrefix(), key);
                ok(out, "Ok (Protobuf).");
            } else {
                store.remove(key);
                new ProtoDatabase(DATABASE_FILE).deleteData(getProjectPrefix(), key);
                ok(out, "Ok (Cache,Protobuf).");
            }
        } catch (IOException e) {
            error(out, "Could not write protobuf storage: " + e.getMessage());
        }
    }
}
