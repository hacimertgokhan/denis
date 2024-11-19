package github.hacimertgokhan;

import github.hacimertgokhan.denisdb.DenisTerminal;
import github.hacimertgokhan.denisdb.cli.DenisMan;
import github.hacimertgokhan.denisdb.DenisClient;
import github.hacimertgokhan.proto.ReadProtoFile;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.readers.ReadDDBProp;
import picocli.CommandLine;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Scanner;

public class Main {
    static DenisLogger denisLogger = new DenisLogger(Main.class);
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static String TOKEN = String.valueOf(readDDBProp.getProperty("ddb-main-token"));
    static boolean delogg = Boolean.parseBoolean((readDDBProp.getProperty("use-delogg")));
    static boolean swd = Boolean.parseBoolean((readDDBProp.getProperty("start-with-details")));
    static int PORT = Integer.parseInt(readDDBProp.getProperty("ddb-port"));
    static String host = String.valueOf(readDDBProp.getProperty("ddb-address"));
    static JsonFile ddb = new JsonFile("ddb.json");
    static final int THREAD_POOL_SIZE = 100; // Maksimum eşzamanlı istemci bağlantısı
    static ExecutorService executor = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
    static ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        denisLogger.warn("Denis Cache Based Database Language, All rights reserved.");
        denisLogger.warn("Welcome to DDB, sttart cache based database with '-start'");
        denisLogger.warn("You can read whole database.bin file with '-read' and you can manage whole DDB (Denis Database) with '-ddb'");
        if (swd)
            denisLogger.info("Denis started with detail mode, close detail mode with '-ddb --opt -swd f'");
            denisLogger.info(String.format("Host: %s, Port: %s", host, PORT));
            if (delogg) denisLogger.info("Delogg (Denis Logg) mode enabled, every actions that server and client logs in 'logs/'");
        Scanner scanner = new Scanner(System.in);
        String mode = scanner.nextLine();
        switch (mode.toLowerCase()) {
            case "-start" -> handleUseMode(scanner);
            case "-ddb" -> {
                handleCLIMode();
            }
            case "-read" -> {
                ReadProtoFile readProtoFile = new ReadProtoFile();
                readProtoFile.Read("database.bin");
            }
            default -> {
                denisLogger.error("Invalid mode selected. Use '-start' or '-ddb'.");
            }
        }
    }

    private static void handleUseMode(Scanner scanner) {
        if (TOKEN.length() == 128) {
            scanner.close();
            try (ServerSocket serverSocket = new ServerSocket(PORT)) {
                denisLogger.info("Server running on port " + PORT);
                denisLogger.info("Your main ddb token is " + TOKEN);
                if (ddb.fileExists()) {
                    denisLogger.info("ddb.json loading...");
                } else {
                    denisLogger.info("ddb.json is not found, creating...");
                    ddb.createEmptyJson();
                }
                DenisTerminal logTerminal = new DenisTerminal();
                logTerminal.startLogTerminal(null);
                logTerminal.writeLog(String.format("Denis started at %s", new Date().toString().toLowerCase(Locale.ROOT)));
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    logTerminal.writeLog(String.format("Denis stopped at %s", new Date().toString().toLowerCase(Locale.ROOT)));
                    logTerminal.closeLogTerminal();
                }));
                while (true) {
                    denisLogger.info("Waiting for client connection...");
                    Socket clientSocket = serverSocket.accept();
                    denisLogger.info("Client connected: " + clientSocket.getInetAddress());
                    logTerminal.writeLog(String.format("Client connected: %s", clientSocket.getInetAddress()));
                    executor.execute(() -> {
                        DenisClient ddbServer = new DenisClient(clientSocket, store, logTerminal);
                        if (delogg) {
                            ddbServer.handleClient(clientSocket, store, logTerminal);
                        } else {
                            ddbServer.handleClient(clientSocket, store);
                        }
                    });
                }
            } catch (IOException e) {
                denisLogger.error("IOException occurred: " + e.getMessage());
                e.printStackTrace();
            }
        } else {
            denisLogger.error("You cannot use DDB without correct token value. (Token length must be 128)");
        }
    }

    private static void handleCLIMode() {
        new CommandLine(new DenisMan()).execute();
    }

}
