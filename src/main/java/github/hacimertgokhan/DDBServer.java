package github.hacimertgokhan;

import github.hacimertgokhan.denisdb.CreateSecureToken;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.pointers.Authories;
import github.hacimertgokhan.readers.ReadDDBProp;
import org.json.JSONObject;

import java.io.*;
import java.net.Socket;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class DDBServer {
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static boolean CLIENT_ACTIONS = Boolean.parseBoolean((readDDBProp.getProperty("send-client-actions")));
    static DDBLogger DDBServer = new DDBLogger(Main.class);
    static JsonFile ddb = new JsonFile("ddb.json");
    static File storageDir = new File("storage");

    private final ConcurrentHashMap<String, Authories> projects;
    private String currentProjectToken = null;

    public DDBServer(Socket socket, ConcurrentHashMap<String, Any> store) {
        this.projects = new ConcurrentHashMap<>();
        if (!storageDir.exists()) {
            storageDir.mkdir();
            DDBServer.info("Storage directory created.");
        }

        try {
            if(ddb.tokenList().size() > 1) {
                for(String tkn : ddb.tokenList()) {
                    registerProject(tkn, tkn);
                    DDBServer.info("Storage loaded with specified token: " + tkn);
                }
            } else {
                DDBServer.info("Token list is empty.");
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        handleClient(socket, store);
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

    private void saveToJson(String key, String value) {
        try {
            JsonFile projectFile = new JsonFile("storage/" + currentProjectToken + ".json");
            if (!projectFile.fileExists()) {
                projectFile.createEmptyJson();
                JSONObject initialData = new JSONObject();
                initialData.put("storage", new JSONObject());
                projectFile.writeJson(initialData);
            }

            JSONObject data = projectFile.readJson();
            if (!data.has("storage")) {
                data.put("storage", new JSONObject());
            }

            JSONObject storage = data.getJSONObject("storage");
            storage.put(key, value);
            projectFile.writeJson(data);

        } catch (IOException e) {
            DDBServer.error("Error saving to JSON: " + e.getMessage());
        }
    }

    private void deleteFromJson(String key) {
        try {
            JsonFile projectFile = new JsonFile("storage/" + currentProjectToken + ".json");
            if (projectFile.fileExists()) {
                JSONObject data = projectFile.readJson();
                if (data.has("storage")) {
                    JSONObject storage = data.getJSONObject("storage");
                    storage.remove(key);
                    projectFile.writeJson(data);
                }
            }
        } catch (IOException e) {
            DDBServer.error("Error deleting from JSON: " + e.getMessage());
        }
    }

    private void loadStorageFromJson(ConcurrentHashMap<String, Any> store) {
        try {
            JsonFile projectFile = new JsonFile("storage/" + currentProjectToken + ".json");
            if (projectFile.fileExists()) {
                JSONObject data = projectFile.readJson();
                if (data.has("storage")) {
                    JSONObject storage = data.getJSONObject("storage");
                    String prefix = getProjectPrefix();
                    store.entrySet().removeIf(entry -> entry.getKey().startsWith(prefix));
                    for (String key : storage.keySet()) {
                        String fullKey = prefix + key;
                        Object value = storage.get(key);
                        store.put(fullKey, new Any(value.toString()));
                    }
                    DDBServer.info("Storage loaded from JSON for token: " + currentProjectToken);
                }
            }
        } catch (IOException e) {
            DDBServer.error("Error loading from JSON: " + e.getMessage());
        }
    }

    private String getProjectPrefix() {
        return currentProjectToken != null ? currentProjectToken + ":" : null;
    }

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store) {
        DDBServer.info("Connecting to DDB server...");
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
                        DDBServer.info(String.format("[CLIENT ACTION] %s action: %s",
                                clientSocket.getInetAddress().getHostAddress(),
                                String.join(" ", parts)));
                    }

                    // Auth komutları
                    if (command.equals("AUTH")) {
                        if (parts.length < 2) {
                            out.println("ERROR: Usage: AUTH <CREATE|token>");
                            continue;
                        }

                        String subCommand = parts[1].toUpperCase();
                        if (subCommand.equals("CREATE")) {
                            CreateSecureToken createSecureToken = new CreateSecureToken();
                            String newToken = createSecureToken.getToken();
                            registerProject(newToken, newToken);

                            try {
                                JsonFile projectFile = new JsonFile("storage/" + newToken + ".json");
                                if (!projectFile.fileExists()) {
                                    projectFile.createEmptyJson();
                                    JSONObject initialData = new JSONObject();
                                    initialData.put("storage", new JSONObject());
                                    projectFile.writeJson(initialData);
                                }

                                ddb.appendToArray("tokens", newToken);
                            } catch (IOException e) {
                                DDBServer.error("Error saving new token: " + e.getMessage());
                                out.println("ERROR: Could not create project");
                                continue;
                            }
                            projects.put(newToken, new Authories(newToken, newToken));
                            out.println(String.format("Project created successfully! Token: %s", newToken));
                            currentProjectToken = newToken;
                            continue;
                        } else {
                            String token = parts[1];
                            if (authenticateProject(token)) {
                                loadStorageFromJson(store);
                                out.println("Authenticated to project: " + token);
                                continue;
                            } else {
                                out.println("ERROR: Invalid token");
                                continue;
                            }
                        }
                    }
                    if (currentProjectToken == null && !command.equals("EXIT")) {
                        out.println("ERROR: Please authenticate first using AUTH command");
                        continue;
                    }

                    switch (command) {
                        case "SET":
                            if (parts.length == 3) {
                                String key = getProjectPrefix() + parts[1];
                                String value = parts[2];
                                store.put(key, new Any(value));
                                saveToJson(parts[1], value);

                                out.println("SETTED!");
                            } else {
                                out.println("ERROR: Usage SET key value");
                            }
                            break;

                        case "UPDATE":
                            if (parts.length == 3) {
                                String key = getProjectPrefix() + parts[1];
                                String value = parts[2];
                                if (store.containsKey(key)) {
                                    store.put(key, new Any(value));
                                    saveToJson(parts[1], value);

                                    out.println("UPDATED!");
                                    DDBServer.info("UPDATE command executed: " + key + " = " + value);
                                } else {
                                    out.println("ERROR: Key not found");
                                }
                            } else {
                                out.println("ERROR: Usage UPDATE key value");
                            }
                            break;

                        case "GET":
                            if (parts.length == 2) {
                                String key = getProjectPrefix() + parts[1];
                                Any value = store.get(key);
                                out.println(value != null ? value.getValue().toString() :
                                        String.format("Key %s not found", parts[1]));
                            } else {
                                out.println("ERROR: Usage GET key");
                            }
                            break;

                        case "DEL":
                            if (parts.length == 2) {
                                String key = getProjectPrefix() + parts[1];
                                store.remove(key);
                                deleteFromJson(parts[1]);

                                out.println("DELETED!");
                            } else {
                                out.println("ERROR: Usage DEL key");
                            }
                            break;

                        case "LOGOUT":
                            currentProjectToken = null;
                            out.println("Logged out successfully");
                            break;

                        case "EXIT":
                            out.println("Bye!");
                            return;

                        default:
                            out.println("ERROR: Unknown command");
                    }
                }
            }
        } catch (IOException e) {
            DDBServer.error("IOException occurred: " + e.getMessage());
            e.printStackTrace();
        } finally {
            try {
                if (!clientSocket.isClosed()) {
                    clientSocket.close();
                }
            } catch (IOException e) {
                DDBServer.error("Error closing client socket: " + e.getMessage());
            }
        }
    }
}