package github.hacimertgokhan;

import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.modals.GlobalModal;
import github.hacimertgokhan.pointers.Any;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;
import java.net.SocketException;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;

public class DDBServer {
    private ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();

    public DDBServer(Socket socket) {
        handleClient(socket);
    }

    public void handleClient(Socket clientSocket) {
        new DDBLogger(DDBServer.class).info("Client connected.");
        try {
            if (clientSocket.isClosed()) {
                new DDBLogger(DDBServer.class).error("Client socket is already closed.");
                return; // Bağlantı kapalı ise işlemi sonlandır
            }

            try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                 PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)) {

                String inputLine;
                while ((inputLine = in.readLine()) != null) {
                    // Soket hala açık mı kontrol et
                    if (clientSocket.isClosed()) {
                        new DDBLogger(DDBServer.class).error("Client socket closed unexpectedly.");
                        break;  // Bağlantı kapalı ise döngüyü sonlandır
                    }

                    String[] parts = inputLine.split(" ", 3);
                    String command = parts[0].toUpperCase();

                    switch (command) {
                        case "SET":
                            if (parts.length == 3) {
                                String key = parts[1];
                                String value = parts[2];
                                store.put(key, new Any(value));
                                out.println("OK");
                            } else {
                                out.println("ERROR: Usage SET key value");
                            }
                            break;

                        case "GET":
                            if (parts.length == 2) {
                                String key = parts[1];
                                Any value = store.get(key);
                                out.println(value != null ? value.getValue() : "NULL");
                            } else {
                                out.println("ERROR: Usage GET key");
                            }
                            break;

                        case "DEL":
                            if (parts.length == 2) {
                                String key = parts[1];
                                store.remove(key);
                                out.println("OK");
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