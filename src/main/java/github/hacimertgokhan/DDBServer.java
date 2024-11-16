package github.hacimertgokhan;

import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.pointers.Authories;
import github.hacimertgokhan.readers.ReadDDBProp;

import java.io.*;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.ConcurrentHashMap;

public class DDBServer {
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static boolean CLIENT_ACTIONS = Boolean.parseBoolean((readDDBProp.getProperty("send-client-actions")));
    static DDBLogger DDBServer = new DDBLogger(Main.class);

    private final ConcurrentHashMap<String, Authories> projects;
    private String currentProjectToken = null;

    public DDBServer(Socket socket, ConcurrentHashMap<String, Any> store) {
        this.projects = new ConcurrentHashMap<>();
        registerProject("1234", "project1_key");
        registerProject("5678", "project2_key");
        handleClient(socket,store);
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

    private String getProjectPrefix() {
        return currentProjectToken != null ? currentProjectToken + ":" : null;
    }

    public void handleClient(Socket clientSocket,  ConcurrentHashMap<String, Any> store) {
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

                    // Auth gerektirmeyen komutlar
                    if (command.equals("AUTH")) {
                        if (parts.length == 2) {
                            String token = parts[1];
                            if (authenticateProject(token)) {
                                out.println("Authenticated to project: " + token);
                                continue;
                            } else {
                                out.println("ERROR: Invalid token");
                                continue;
                            }
                        } else {
                            out.println("ERROR: Usage AUTH token");
                            continue;
                        }
                    }

                    // Auth gerektiren komutlar için kontrol
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