package github.hacimertgokhan.denis;

import database.Token;
import github.hacimertgokhan.Main;
import github.hacimertgokhan.denis.client.ClientStates;
import github.hacimertgokhan.denis.sections.group.Group;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.pointers.Authories;
import github.hacimertgokhan.proto.ProtoDatabase;
import github.hacimertgokhan.readers.DenisProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.*;
import java.net.Socket;
import java.util.*;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

public class DenisClient {
    private static final Logger log = LogManager.getLogger(DenisClient.class);
    static DenisProperties denisProperties = new DenisProperties();
    static boolean CLIENT_ACTIONS = Boolean.parseBoolean((denisProperties.getProperty("send-client-actions")));
    static DenisLogger DDBServer = new DenisLogger(Main.class);
    static JsonFile ddb = new JsonFile("ddb.json");
    static File storageDir = new File("storage");
    private final ConcurrentHashMap<String, Authories> projects;
    private String currentProjectToken = null;
    private final BlockingQueue<Runnable> taskQueue = new LinkedBlockingQueue<>();
    private List<String> accessList = new ArrayList<>();
    private ClientStates currentClientState = ClientStates.INITIAL;

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
            this.group=group;
            this.password=password;
        }

        public Login() {}

        public boolean join(PrintWriter out) {
            if(!isLogged()) {
                Group group = new Group(this.group);
                if (group.isExists()) {
                    if (group.in(password)) {
                        setLogged(true);
                        out.println("You're logged in.");
                        accessList = group.getAccessList();
                        return true;
                    } else {
                        setLogged(false);
                        out.println("Unknow hash or password.");
                        return false;
                    }
                } else {
                    out.println("Unknow string encryption.");
                    setLogged(false);
                    return false;
                }
            } else {
                out.println("You're already logged in.");
                return true;
            }
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

    public void sendWelcomeMessage(PrintWriter out) {
        out.println(String.format("[Welcome - %s]: Welcome to Denis! Please authenticate using AUTH command.", new Date()));
    }

    public DenisClient(Socket socket, ConcurrentHashMap<String, Any> store, DenisTerminal logTerminal) {
        this.projects = new ConcurrentHashMap<>();
        if (!storageDir.exists()) {
            storageDir.mkdir();
            DDBServer.info("Storage directory created.");
        }

        try {
            if (!ddb.tokenList().isEmpty()) {
                for (String tkn : ddb.tokenList()) {
                    registerProject(tkn, tkn);
                    DDBServer.info("Storage loaded with specified token: " + tkn);
                }
            } else {
                DDBServer.info("Token list is empty.");
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        Thread workerThread = new Thread(this::processTasks);
        workerThread.start();

        handleClient(socket, store, logTerminal);
    }

    public DenisClient(Socket socket, ConcurrentHashMap<String, Any> store) {
        this.projects = new ConcurrentHashMap<>();
        if (!storageDir.exists()) {
            storageDir.mkdir();
            DDBServer.info("Storage directory created.");
        }

        try {
            if (!ddb.tokenList().isEmpty()) {
                for (String tkn : ddb.tokenList()) {
                    registerProject(tkn, tkn);
                    DDBServer.info("Storage loaded with specified token: " + tkn);
                }
            } else {
                DDBServer.info("Token list is empty.");
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        Thread workerThread = new Thread(this::processTasks);
        workerThread.start();

        handleClient(socket, store);
    }

    private void processTasks() {
        while (true) {
            try {
                Runnable task = taskQueue.take();
                task.run();
            } catch (InterruptedException e) {
                DDBServer.error("Task processing interrupted: " + e.getMessage());
            }
        }
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

    private void loadStorageFromProtobuf(ConcurrentHashMap<String, Any> store, String token) {
        try {
            FileInputStream fileInputStream = new FileInputStream("database.bin");
            Token.TokenData tokenStorage = Token.TokenData.parseFrom(fileInputStream);
            fileInputStream.close();
            if (tokenStorage.getToken().equals(token)) {
                String prefix = getProjectPrefix();
                store.entrySet().removeIf(entry -> entry.getKey().startsWith(prefix));
                for (Map.Entry<String, String> entry : tokenStorage.getKeyValuesMap().entrySet()) {
                    String fullKey = prefix + entry.getKey();
                    store.put(fullKey, new Any(entry.getValue()));
                }
                DDBServer.info("Storage loaded from Protobuf for token: " + token);
            } else {
                DDBServer.error("Token mismatch: Expected " + token + ", but found " + tokenStorage.getToken());
            }

        } catch (IOException e) {
            DDBServer.error("Error loading from Protobuf: " + e.getMessage());
        }
    }
    private String getProjectPrefix() {
        return currentProjectToken != null ? currentProjectToken + ":" : null;
    }

    public void clientLogg(int level, PrintWriter printWriter, String message) {
        switch (level) {
            case 0 -> {
                printWriter.println(String.format("[Info - %s]: %s",new Date(), message));
            }
            case 1 -> {
                printWriter.println(String.format("[Debug - %s]: %s",new Date(), message));
            }
            case 2 -> {
                printWriter.println(String.format("[Error - %s]: %s",new Date(), message));
            }
            default -> throw new IllegalStateException("Unexpected value: " + level);
        }
    }

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store, DenisTerminal logTerminal) {
        DDBServer.info("Waiting for client connection...");
        boolean logged_in = false;
        try {
            if (clientSocket == null || clientSocket.isClosed()) {
                return;
            }

            try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                 PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)) {
                String inputLine;
                while ((inputLine = in.readLine()) != null) {
                    if (clientSocket.isClosed()) {
                        DDBServer.error("Client socket closed unexpectedly.");
                        break;
                    }

                    String[] parts = inputLine.split(" ", 3);
                    String command = parts[0].toUpperCase();

                    if (CLIENT_ACTIONS) {
                        logTerminal.writeLog(String.format("[CLIENT] %s action: %s",
                                clientSocket.getInetAddress().getHostAddress(),
                                String.join(" ", parts)));
                        DDBServer.info(String.format("[CLIENT] %s action: %s",
                                clientSocket.getInetAddress().getHostAddress(),
                                String.join(" ", parts)));
                    }

                    // LIN ve AUTH komutlarına öncelik ver
                    if (!logged_in && !command.equals("LIN")) {
                        clientLogg(2, out, "Please login first using LIN command");
                        continue;
                    }

                    if (logged_in && currentProjectToken == null && !command.equals("AUTH") && !command.equals("EXIT")) {
                        clientLogg(2, out, "Please authenticate first using AUTH command");
                        continue;
                    }

                    // LIN komutu
                    if (!logged_in && command.equals("LIN")) {
                        if (parts.length < 3) {
                            clientLogg(2, out, "USAGE: LIN <Group> <Password>");
                            continue;
                        }
                        String group = parts[1];
                        String pwd = parts[2];
                        Login login = new Login(group, pwd);
                        logged_in = login.join(out);
                        continue;
                    }

                    // AUTH komutu
                    if (logged_in && command.equals("AUTH")) {
                        if (parts.length < 2) {
                            clientLogg(2, out, "ERROR: Usage: AUTH <CREATE|token>");
                            continue;
                        }

                        String subCommand = parts[1].toUpperCase();
                        if (subCommand.equals("CREATE")) {
                            String newToken = new CreateSecureToken().getToken();
                            registerProject(newToken, newToken);
                            try {
                                ddb.appendToArray("tokens", newToken);
                                clientLogg(2, out, "Project created! Token: " + newToken);
                            } catch (IOException e) {
                                DDBServer.error("Error saving new token: " + e.getMessage());
                                clientLogg(2, out, "Could not create project");
                            }
                        } else {
                            String token = parts[1];
                            if (accessList.contains(token)) {
                                if (authenticateProject(token)) {
                                    loadStorageFromProtobuf(store, token);
                                    clientLogg(0, out, "Authenticated to project: " + token);
                                } else {
                                    clientLogg(2, out, "Invalid token: " + token);
                                }
                            } else {
                                clientLogg(2, out, "Cannot auth with: " + token);
                            }
                        }
                        continue;
                    }

                    if (logged_in && currentProjectToken == null && !command.equals("EXIT")) {
                        clientLogg(2, out, "Please authenticate first using AUTH command");
                        continue;
                    }
                    if (!logged_in && !command.equals("EXIT")) {
                        clientLogg(2, out, "Please login first using LIN command");
                        continue;
                    }
                    taskQueue.add(() -> {
                        String key = getProjectPrefix() + parts[1];
                        Any data = store.get(key);
                        switch (command) {
                            case "HEAVEN":
                                store.clear();
                                clientLogg(0, out, "Ok.");
                            case "GET":
                                try {
                                    if (parts.length >= 2) {
                                        String flagsAndValue = parts.length > 2 ? parts[2] : ""; // bayraklar varsa al
                                        String[] flags = flagsAndValue.split(" "); // bayrakları ayır
                                        boolean fromCache = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&from-cache"));
                                        boolean asJson = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&asa-json"));
                                        boolean fromProtoBuff = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&from-protobuff"));

                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");

                                        // Cache'ten veri almak
                                        if (fromCache) {
                                            if (data != null) {
                                                out.println(data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // JSON formatında veri almak
                                        else if (asJson) {
                                            if (data != null) {
                                                out.println(String.format("{\"key\": \"%s\", \"data\": \"%s\"}", key.split(":")[1], data.getValue()));
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // ProtoBuffer'dan veri almak
                                        else if (fromProtoBuff) {
                                            if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                out.println(finalDb.getData(getProjectPrefix(), key));
                                            } else {
                                                out.println(String.format("err: %s not found in protobuff", key.split(":")[1]));
                                            }
                                        }
                                        // Hem ProtoBuffer hem JSON formatında veri almak
                                        else if (fromProtoBuff && asJson) {
                                            if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                out.println(finalDb.getData(getProjectPrefix(), key));
                                            } else {
                                                out.println(String.format("err: %s not found in protobuff", key.split(":")[1]));
                                            }
                                        }
                                        // Hem cache hem JSON formatında veri almak
                                        else if (fromCache && asJson) {
                                            if (data != null) {
                                                out.println(String.format("{\"key\": \"%s\", \"data\": \"%s\"}", key.split(":")[1], data.getValue()));
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // Default: sadece key ile veri almak
                                        else {
                                            if (data != null) {
                                                out.println(data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found", key.split(":")[1]));
                                            }
                                        }
                                    } else {
                                        out.println("USAGE: GET <key> [-&from-cache,-&from-protobuff] [-&asa-json]");
                                    }
                                } catch (IOException e) {
                                    throw new RuntimeException(e);
                                }
                                break;

                            case "SET":
                                if (parts.length >= 3) {
                                    String valueAndFlags = parts[2];
                                    String[] valueParts = valueAndFlags.split(" ");
                                    String value = valueParts[0];
                                    boolean save = Arrays.stream(valueParts).anyMatch(s -> s.equalsIgnoreCase("-&save"));
                                    store.put(key, new Any(value));
                                    boolean protoSaved = false;
                                    if (save) {
                                        try {
                                            ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                            finalDb.setData(getProjectPrefix(), key, new Any(value));
                                            protoSaved = true;
                                        } catch (IOException e) {
                                            throw new RuntimeException(e);
                                        }
                                    }
                                    StringBuilder message = new StringBuilder("Ok (Cache");
                                    if (protoSaved) {
                                        message.append(", Protobuf");
                                    }
                                    message.append(")");
                                    clientLogg(0, out, message.toString());
                                } else {
                                    out.println("USAGE: SET <key> <value> [-&save]");
                                }
                                break;
                            case "DEL":
                                if (parts.length >= 2) {
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.deleteData(getProjectPrefix(), key);
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    store.remove(key);
                                    clientLogg(0, out, "Ok.");
                                } else {
                                    out.println("USAGE: DEL <key>");
                                }
                                break;

                            case "UPDATE":
                                if (parts.length >= 3) {
                                    String newValue = parts[2];
                                    store.put(key, new Any(newValue));
                                    clientLogg(0, out, "Ok.");
                                } else {
                                    out.println("USAGE: UPDATE <key> <newValue>");
                                }
                                break;

                            default:
                                out.println("ERROR: Unknown command");
                        }
                    });
                }
            }
        } catch (IOException e) {
            DDBServer.error("Error handling client: " + e.getMessage());
        }
    }

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store) {
        DDBServer.info("Waiting for client connection...");
        try {
            if (clientSocket == null || clientSocket.isClosed()) {
                return;
            }

            try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                 PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)) {
                sendWelcomeMessage(out);
                String inputLine;
                while ((inputLine = in.readLine()) != null) {
                    if (clientSocket.isClosed()) {
                        DDBServer.error("Client socket closed unexpectedly.");
                        break;
                    }

                    String[] parts = inputLine.split(" ", 3);
                    String command = parts[0].toUpperCase();

                    if (CLIENT_ACTIONS) {
                        DDBServer.info(String.format("[CLIENT] %s action: %s",
                                clientSocket.getInetAddress().getHostAddress(),
                                String.join(" ", parts)));
                    }

                    if (command.equals("AUTH")) {
                        if (parts.length < 2) {
                            clientLogg(2, out, "ERROR: Usage: AUTH <CREATE|token>");
                            continue;
                        }

                        String subCommand = parts[1].toUpperCase();
                        if (subCommand.equals("CREATE")) {
                            taskQueue.add(() -> {
                                String newToken = new CreateSecureToken().getToken();
                                registerProject(newToken, newToken);
                                try {
                                    ddb.appendToArray("tokens", newToken);
                                    clientLogg(2, out, "Project created! Token: " + newToken);
                                } catch (IOException e) {
                                    DDBServer.error("Error saving new token: " + e.getMessage());
                                    clientLogg(2, out, "Could not create project");
                                }
                            });
                        } else {
                            taskQueue.add(() -> {
                                String token = parts[1];
                                if (authenticateProject(token)) {
                                    loadStorageFromProtobuf(store, token);
                                    clientLogg(0, out, "Authenticated to project: " + token);
                                } else {
                                    clientLogg(2, out, "Invalid token: " + token);
                                }
                            });
                        }
                        continue;
                    }
                    if (currentProjectToken == null && !command.equals("EXIT")) {
                        clientLogg(2, out, "Please authenticate first using AUTH command");
                        continue;
                    }
                    taskQueue.add(() -> {
                        String key = getProjectPrefix() + parts[1];
                        Any data = store.get(key);
                        switch (command) {
                            case "HEAVEN":
                                store.clear();
                                clientLogg(0, out, "Ok.");
                            case "GET":
                                try {
                                    if (parts.length >= 2) {
                                        String flagsAndValue = parts.length > 2 ? parts[2] : ""; // bayraklar varsa al
                                        String[] flags = flagsAndValue.split(" "); // bayrakları ayır
                                        boolean fromCache = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&from-cache"));
                                        boolean asJson = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&asa-json"));
                                        boolean fromProtoBuff = Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase("-&from-protobuff"));

                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");

                                        // Cache'ten veri almak
                                        if (fromCache) {
                                            if (data != null) {
                                                out.println(data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // JSON formatında veri almak
                                        else if (asJson) {
                                            if (data != null) {
                                                out.println(String.format("{\"key\": \"%s\", \"data\": \"%s\"}", key.split(":")[1], data.getValue()));
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // ProtoBuffer'dan veri almak
                                        else if (fromProtoBuff) {
                                            if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                out.println(finalDb.getData(getProjectPrefix(), key));
                                            } else {
                                                out.println(String.format("err: %s not found in protobuff", key.split(":")[1]));
                                            }
                                        }
                                        // Hem ProtoBuffer hem JSON formatında veri almak
                                        else if (fromProtoBuff && asJson) {
                                            if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                out.println(finalDb.getData(getProjectPrefix(), key));
                                            } else {
                                                out.println(String.format("err: %s not found in protobuff", key.split(":")[1]));
                                            }
                                        }
                                        // Hem cache hem JSON formatında veri almak
                                        else if (fromCache && asJson) {
                                            if (data != null) {
                                                out.println(String.format("{\"key\": \"%s\", \"data\": \"%s\"}", key.split(":")[1], data.getValue()));
                                            } else {
                                                out.println(String.format("err: %s not found in cache", key.split(":")[1]));
                                            }
                                        }
                                        // Default: sadece key ile veri almak
                                        else {
                                            if (data != null) {
                                                out.println(data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found", key.split(":")[1]));
                                            }
                                        }
                                    } else {
                                        out.println("USAGE: GET <key> [-&from-cache,-&from-protobuff] [-&asa-json]");
                                    }
                                } catch (IOException e) {
                                    throw new RuntimeException(e);
                                }
                                break;

                            case "SET":
                                if (parts.length >= 3) {
                                    String valueAndFlags = parts[2];
                                    String[] valueParts = valueAndFlags.split(" ");
                                    String value = valueParts[0];
                                    boolean save = Arrays.stream(valueParts).anyMatch(s -> s.equalsIgnoreCase("-&save"));
                                    store.put(key, new Any(value));
                                    clientLogg(0, out, "Ok.");
                                    if (save) {
                                        try {
                                            ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                            finalDb.setData(getProjectPrefix(), key, new Any(value));
                                            clientLogg(0, out, "Saved to protobuff.");
                                        } catch (IOException e) {
                                            throw new RuntimeException(e);
                                        }
                                    }
                                    String newValue = parts[2];
                                    store.put(key, new Any(newValue));
                                    clientLogg(0, out, "Saved to cache.");
                                } else {
                                    out.println("ERROR: USAGE: SET <key> <value> [-&save]");
                                }
                                break;
                            case "DEL":
                                if (parts.length >= 2) {
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.deleteData(getProjectPrefix(), key);
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    store.remove(key);
                                    clientLogg(0, out, "Ok.");
                                } else {
                                    out.println("ERROR: USAGE: DEL key [<-save>]");
                                }
                                break;

                            case "UPDATE":
                                if (parts.length >= 3) {
                                    String newValue = parts[2];
                                    store.put(key, new Any(newValue));
                                    clientLogg(0, out, "Ok.");
                                } else {
                                    out.println("ERROR: USAGE: UPDATE key newValue [<-save>]");
                                }
                                break;

                            default:
                                out.println("ERROR: Unknown command");
                        }
                    });
                }
            }
        } catch (IOException e) {
            DDBServer.error("Error handling client: " + e.getMessage());
        }
    }
}
