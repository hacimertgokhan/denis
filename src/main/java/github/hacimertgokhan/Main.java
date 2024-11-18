package github.hacimertgokhan;

import github.hacimertgokhan.denisdb.CreateSecureToken;
import github.hacimertgokhan.denisdb.DDBServer;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.readers.ReadDDBProp;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Scanner;

public class Main {
    static DDBLogger ddbLogger = new DDBLogger(Main.class);
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static String TOKEN = String.valueOf(readDDBProp.getProperty("ddb-main-token"));
    static int PORT = Integer.parseInt(readDDBProp.getProperty("ddb-port"));
    static JsonFile ddb = new JsonFile("ddb.json");
    static final int THREAD_POOL_SIZE = 100000; // Maksimum eşzamanlı istemci bağlantısı
    static ExecutorService executor = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
    static ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        ddbLogger.warn("Welcome to DDB, create cache based database with '-use' or manage your ddb with '-man'");
        Scanner scanner = new Scanner(System.in);
        String mode = scanner.nextLine();

        switch (mode.toLowerCase()) {
            case "-use" -> handleUseMode(scanner);
            case "-man" -> handleManagementMode(scanner);
            default -> ddbLogger.error("Invalid mode selected. Use '-use' or '-man'.");
        }
    }

    private static void handleUseMode(Scanner scanner) {
        if (TOKEN.length() == 128) {
            scanner.close();
            try (ServerSocket serverSocket = new ServerSocket(PORT)) {
                ddbLogger.info("Server running on port " + PORT);
                ddbLogger.info("Your main ddb token is " + TOKEN);
                if (ddb.fileExists()) {
                    ddbLogger.info("ddb.json loading...");
                } else {
                    ddbLogger.info("ddb.json is not found, creating...");
                    ddb.createEmptyJson();
                }
                while (true) {
                    ddbLogger.info("Waiting for client connection...");
                    Socket clientSocket = serverSocket.accept();
                    ddbLogger.info("Client connected: " + clientSocket.getInetAddress());
                    executor.execute(() -> {
                        DDBServer ddbServer = new DDBServer(clientSocket, store);
                        ddbServer.handleClient(clientSocket, store);
                    });
                }

            } catch (IOException e) {
                ddbLogger.error("IOException occurred: " + e.getMessage());
                e.printStackTrace();
            }
        } else {
            ddbLogger.error("You cannot use DDB without correct token value. (Token length must be 128)");
        }
    }

    private static void handleManagementMode(Scanner scanner) {
        ddbLogger.warn("Hello, you're in Management mode, Please be careful.");
        boolean man = true;

        while (man) {
            ddbLogger.info("Enter a management command:");
            String[] actCommand = scanner.nextLine().split(" ");

            if (actCommand == null || actCommand.length == 0) {
                ddbLogger.error("Commands cannot be null or empty.");
                continue;
            }

            switch (actCommand[0]) {
                case "--exit" -> {
                    ddbLogger.error("You're leaving DDB Man mode, Bye bye.");
                    man = false;
                }
                case "--create" -> {
                    if (actCommand.length == 2 && actCommand[1].equals("-token")) {
                        CreateSecureToken createSecureToken = new CreateSecureToken();
                        String token = createSecureToken.getToken();
                        ddbLogger.info("Your unique DDB token created successfully;");
                        ddbLogger.info(token);
                    } else {
                        ddbLogger.error("Invalid syntax for --create command. Usage: --create -token");
                    }
                }
                default -> ddbLogger.error("Unexpected command: " + String.join(" ", actCommand));
            }
        }
    }
}
