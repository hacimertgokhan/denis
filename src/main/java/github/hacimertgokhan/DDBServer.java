package github.hacimertgokhan;

import github.hacimertgokhan.denisdb.protocols.ConnectionInfo;
import github.hacimertgokhan.denisdb.protocols.Telnet;
import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.readers.ReadDDBProp;

import java.io.*;
import java.net.Socket;
import java.util.Arrays;

import java.util.concurrent.ConcurrentHashMap;

public class DDBServer {
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static boolean CLIENT_ACTIONS = Boolean.parseBoolean((readDDBProp.getProperty("send-client-actions")));
    static DDBLogger DDBServer = new DDBLogger(Main.class);

    private ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();
    public DDBServer(Socket socket) {
        handleClient(socket);
    }

    public void handleClient(Socket clientSocket) {
        new DDBLogger(DDBServer.class).info("Connecting to DDB server...");
        try {
            if (clientSocket==null) {
                return;
            }
            if (clientSocket.isClosed()) {
                return;
            }
            try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                 PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)) {
                String inputLine;
                while ((inputLine = in.readLine()) != null) {
                    if (clientSocket.isClosed()) {
                        new DDBLogger(DDBServer.class).error("Client socket closed unexpectedly.");
                        break;
                    }

                    String[] parts = inputLine.split(" ", 3);
                    String command = parts[0].toUpperCase();

                    if (CLIENT_ACTIONS) {
                        if (command.equalsIgnoreCase("GET") || command.equalsIgnoreCase("SET") || command.equalsIgnoreCase("UPDATE") || command.equalsIgnoreCase("DEL") || command.equalsIgnoreCase("EXIT")) {
                            DDBServer.info(String.format("[CLIENT ACTION] %s action: %s", clientSocket.getInetAddress().getHostAddress(), Arrays.toString(parts).replace("[", "").replace("]", "").replace(",", "")));
                        }
                    }

                    switch (command) {
                        case "SET":
                            if (parts.length == 3) {
                                String key = parts[1];
                                String value = parts[2];
                                store.put(key, new Any(value));
                                out.println("SETTED !");
                            } else {
                                out.println("ERROR: Usage SET key value");
                            }
                            break;
                        case "UPDATE":
                            if (parts.length == 3) {
                                String key = parts[1];
                                String value = parts[2];
                                if (store.containsKey(key)) {
                                    store.put(key, new Any(value));
                                    out.println("UPDATED !");
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
                                String key = parts[1];
                                Any value = store.get(key);
                                out.println(value != null ? value.getValue().toString() : String.format("Key %s not found", key));
                            } else {
                                out.println("ERROR: Usage GET key");
                            }
                            break;

                        case "DEL":
                            if (parts.length == 2) {
                                String key = parts[1];
                                store.remove(key);
                                out.println("DELETED !");
                            } else {
                                out.println("ERROR: Usage DEL key");
                            }
                            break;

                        case "EXIT":
                            out.println("Bye!");
                            clientSocket.close(); // Exit komutuyla bağlantı kapanacak
                            return;

                        default:
                            out.println("ERROR: Unknown command");
                    }
                }
            } catch (IOException e) {
                new DDBLogger(DDBServer.class).error("IOException occurred: " + e.getMessage());
                e.printStackTrace();
            }
        } finally {
            try {
                if (!clientSocket.isClosed()) {
                    clientSocket.close();  // Eğer soket hala açıksa, kapat
                }
            } catch (IOException e) {
                new DDBLogger(DDBServer.class).error("Error closing client socket: " + e.getMessage());
            }
        }
    }

}