package github.hacimertgokhan.denisdb;

import database.Token;
import github.hacimertgokhan.Main;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.pointers.Authories;
import github.hacimertgokhan.proto.ProtoDatabase;
import github.hacimertgokhan.readers.ReadDDBProp;
import org.json.JSONObject;

import java.io.*;
import java.net.Socket;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

public class DenisClient {
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static boolean CLIENT_ACTIONS = Boolean.parseBoolean((readDDBProp.getProperty("send-client-actions")));
    static DenisLogger DDBServer = new DenisLogger(Main.class);
    static JsonFile ddb = new JsonFile("ddb.json");
    static File storageDir = new File("storage");

    private final ConcurrentHashMap<String, Authories> projects;
    private String currentProjectToken = null;

    private final BlockingQueue<Runnable> taskQueue = new LinkedBlockingQueue<>();

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

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store, DenisTerminal logTerminal) {
        DDBServer.info("Waiting for client connection...");
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

                    if (command.equals("AUTH")) {
                        if (parts.length < 2) {
                            out.println("ERROR: Usage: AUTH <CREATE|token>");
                            continue;
                        }

                        String subCommand = parts[1].toUpperCase();
                        if (subCommand.equals("CREATE")) {
                            taskQueue.add(() -> {
                                String newToken = new CreateSecureToken().getToken();
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
                                    out.println("Project created successfully! Token: " + newToken);
                                } catch (IOException e) {
                                    DDBServer.error("Error saving new token: " + e.getMessage());
                                    out.println("ERROR: Could not create project");
                                }
                            });
                        } else {
                            taskQueue.add(() -> {
                                String token = parts[1];
                                if (authenticateProject(token)) {
                                    loadStorageFromProtobuf(store, token);
                                    out.println("Authenticated to project: " + token);
                                } else {
                                    out.println("ERROR: Invalid token");
                                }
                            });
                        }
                        continue;
                    }

                    if (currentProjectToken == null && !command.equals("EXIT")) {
                        out.println("ERROR: Please authenticate first using AUTH command");
                        continue;
                    }
                    taskQueue.add(() -> {
                        switch (command) {
                            case "GET":

                                if (parts.length > 2) {
                                    String key = getProjectPrefix() + parts[1];
                                    Any data = store.get(key);
                                    for (String subs : (parts)) {
                                        if (subs.contains("-only-pbuff")) {
                                            try {
                                                ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                                if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                    out.println(finalDb.getData(getProjectPrefix(), key));
                                                } else {
                                                    out.println(String.format("err: %s not found ", key));
                                                }
                                            } catch (IOException e) {
                                                throw new RuntimeException(e);
                                            }
                                        } else if (subs.contains("-only-cache")) {
                                            if (data != null) {
                                                out.println(data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found ", key));
                                            }
                                        } else {
                                            try {
                                                ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                                if (finalDb.getData(getProjectPrefix(), key) != null) {
                                                    out.println("pbuff: " + finalDb.getData(getProjectPrefix(), key));
                                                }
                                            } catch (IOException e) {
                                                throw new RuntimeException(e);
                                            }
                                            if (data != null) {
                                                out.println("cache:" + data.getValue());
                                            } else {
                                                out.println(String.format("err: %s not found ", key));
                                            }
                                        }
                                    }
                                } else if (parts.length == 2) {
                                    String key = getProjectPrefix() + parts[1];
                                    Any data = store.get(key);
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        if (finalDb.getData(getProjectPrefix(), key) != null) {
                                            out.println("pbuff: " + finalDb.getData(getProjectPrefix(), key));
                                        }
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    if (data != null) {
                                        out.println("cache:" + data.getValue());
                                    } else {
                                        out.println(String.format("err: %s not found ", key));
                                    }
                                } else {
                                    out.println("ERROR: USAGE: GET key");
                                }
                                break;
                            case "SET":
                                if (parts.length >= 3) {
                                    String key = getProjectPrefix() + parts[1];
                                    String value = parts[2];
                                    store.put(key, new Any(value));
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.setData(getProjectPrefix(), key, new Any(value));
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    out.println("Ok!");
                                } else {
                                    out.println("ERROR: USAGE: SET key value [<-save>]");
                                }
                                break;

                            case "DEL":
                                if (parts.length >= 2) {
                                    String key = getProjectPrefix() + parts[1];
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.deleteData(getProjectPrefix(), key);
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    store.remove(key);
                                    out.println("Ok!");
                                } else {
                                    out.println("ERROR: USAGE: DEL key [<-save>]");
                                }
                                break;

                            case "UPDATE":
                                if (parts.length >= 3) {
                                    String key = getProjectPrefix() + parts[1];
                                    String newValue = parts[2];
                                    store.put(key, new Any(newValue));
                                    out.println("Ok!");
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

    public void handleClient(Socket clientSocket, ConcurrentHashMap<String, Any> store) {
        DDBServer.info("Waiting for client connection...");
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
                        DDBServer.info(String.format("[CLIENT] %s action: %s",
                                clientSocket.getInetAddress().getHostAddress(),
                                String.join(" ", parts)));
                    }

                    if (command.equals("AUTH")) {
                        if (parts.length < 2) {
                            out.println("ERROR: Usage: AUTH <CREATE|token>");
                            continue;
                        }

                        String subCommand = parts[1].toUpperCase();
                        if (subCommand.equals("CREATE")) {
                            taskQueue.add(() -> {
                                String newToken = new CreateSecureToken().getToken();
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
                                    out.println("Project created successfully! Token: " + newToken);
                                } catch (IOException e) {
                                    DDBServer.error("Error saving new token: " + e.getMessage());
                                    out.println("ERROR: Could not create project");
                                }
                            });
                        } else {
                            taskQueue.add(() -> {
                                String token = parts[1];
                                if (authenticateProject(token)) {
                                    loadStorageFromProtobuf(store, token);
                                    out.println("Authenticated to project: " + token);
                                } else {
                                    out.println("ERROR: Invalid token");
                                }
                            });
                        }
                        continue;
                    }

                    if (currentProjectToken == null && !command.equals("EXIT")) {
                        out.println("ERROR: Please authenticate first using AUTH command");
                        continue;
                    }
                    taskQueue.add(() -> {
                        switch (command) {
                            case "GET":

                                if (parts.length == 2) {
                                    String key = getProjectPrefix() + parts[1];
                                    Any data = store.get(key);
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        if(finalDb.getData(getProjectPrefix(), key) != null) {
                                            out.println("pbuff:" + finalDb.getData(getProjectPrefix(), key));
                                        }
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    if (data != null) {
                                        out.println("cache:"+data.getValue());
                                    } else {
                                        out.println("ERROR: No data found for key: " + key);
                                    }
                                } else {
                                    out.println("ERROR: USAGE: GET key");
                                }
                                break;
                            case "SET":
                                if (parts.length >= 3) {
                                    String key = getProjectPrefix() + parts[1];
                                    String value = parts[2];
                                    store.put(key, new Any(value));
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.setData(getProjectPrefix(), key, new Any(value));
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    out.println("Ok.");
                                } else {
                                    out.println("ERROR: USAGE: SET key value [<-save>]");
                                }
                                break;

                            case "DEL":
                                if (parts.length >= 2) {
                                    String key = getProjectPrefix() + parts[1];
                                    try {
                                        ProtoDatabase finalDb = new ProtoDatabase("database.bin");
                                        finalDb.deleteData(getProjectPrefix(), key);
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                    store.remove(key);
                                    out.println("Ok.");
                                } else {
                                    out.println("ERROR: USAGE: DEL key [<-save>]");
                                }
                                break;

                            case "UPDATE":
                                if (parts.length >= 3) {
                                    String key = getProjectPrefix() + parts[1];
                                    String newValue = parts[2];
                                    store.put(key, new Any(newValue));
                                    out.println("Ok.");
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
