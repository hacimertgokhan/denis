package github.hacimertgokhan;

import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.readers.ReadDDBProp;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;

public class Main {
    static DDBLogger ddbLogger = new DDBLogger(Main.class);
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static int PORT = Integer.parseInt(readDDBProp.getProperty("ddb-port"));

    public static void main(String[] args) {
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            ddbLogger.info("Server running on port " + PORT);
            boolean isLoggedIn=false,isUsernameEntered=false,isPasswordEntered=false;
            while (true) {
                ddbLogger.info("Waiting for client connection...");
                Socket clientSocket = serverSocket.accept();
                ddbLogger.info("Client connected: " + clientSocket.getInetAddress());
                new Thread(() -> {
                    DDBServer ddbServer = new DDBServer(clientSocket);
                    ddbServer.handleClient(clientSocket);
                }).start();
            }
        } catch (IOException e) {
            ddbLogger.error("IOException occurred: " + e.getMessage());
            e.printStackTrace();
        }
    }

}