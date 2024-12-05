package github.hacimertgokhan;

import github.hacimertgokhan.denisdb.DenisTerminal;
import github.hacimertgokhan.denisdb.DenisClient;
import github.hacimertgokhan.denisdb.language.DenisLanguage;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.readers.DenisProperties;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Main {
    static DenisLogger denisLogger = new DenisLogger(Main.class);
    static DenisProperties denisProperties = new DenisProperties();
    static String TOKEN = denisProperties.getProperty("ddb-main-token");
    static boolean delogg = Boolean.parseBoolean(denisProperties.getProperty("use-delogg"));
    static boolean swd = Boolean.parseBoolean(denisProperties.getProperty("start-with-details"));
    static int PORT = Integer.parseInt(denisProperties.getProperty("ddb-port"));
    static String host = denisProperties.getProperty("ddb-address");
    static JsonFile ddb = new JsonFile("ddb.json");
    static final int THREAD_POOL_SIZE = 100;
    static ExecutorService executor = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
    static ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();
    static final int MAX_CONNECTIONS_PER_IP = Integer.parseInt(denisProperties.getProperty("max-connections-per-ip"));
    static ConcurrentHashMap<InetAddress, Integer> ipConnectionCount = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        List<String> list;
        try {
            list = new DenisLanguage().getLanguageFile().getList("startup-information");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        for(String s : list) {
            denisLogger.info(s);
        }
        if (swd) {
            List<String> swdList;
            try {
                swdList = new DenisLanguage().getLanguageFile().getList("startup-swd");
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            for(String s : swdList) {
                denisLogger.info(s.replace("<host>", host).replace("<port>", String.valueOf(PORT)));
            }
            if (delogg) {
                try {
                    denisLogger.info(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("denis-global-logger")));
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }

            }
        }
        handleUseMode();
    }

    private static void handleUseMode() {
        if (TOKEN.length() == 128) {
            try (ServerSocket serverSocket = new ServerSocket(PORT)) {
                List<String> swdList;
                try {
                    swdList = new DenisLanguage().getLanguageFile().getList("startup-port-and-token-information");
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
                for(String s : swdList) {
                    denisLogger.info(s.replace("<port>", String.valueOf(PORT)).replace("<token>", TOKEN));
                }
                if (!ddb.fileExists()) {
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
                    Runtime.getRuntime().gc();
                    denisLogger.info((String) new DenisLanguage().getLanguageFile().readJson().get("waiting-for-client-connection"));
                    Socket clientSocket = serverSocket.accept();
                    InetAddress clientAddress = clientSocket.getInetAddress();
                    int currentConnections = ipConnectionCount.getOrDefault(clientAddress, 0);
                    if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
                        denisLogger.warn("Connection limit reached for IP address: " + clientAddress);
                        clientSocket.close(); // Close the socket immediately
                        continue;
                    }
                    ipConnectionCount.put(clientAddress, currentConnections + 1);
                    denisLogger.info((new DenisLanguage().getLanguageFile().readJson().get("client-connected").toString()).replace("<socket>", clientAddress.toString()));
                    logTerminal.writeLog(String.format("Client connected: %s", clientAddress));
                    executor.execute(() -> {
                        DenisClient ddbServer = new DenisClient(clientSocket, store, logTerminal);
                        try {
                            if (delogg) {
                                ddbServer.handleClient(clientSocket, store, logTerminal);
                            } else {
                                ddbServer.handleClient(clientSocket, store);
                            }
                        } finally {
                            ipConnectionCount.put(clientAddress, Math.max(0, ipConnectionCount.get(clientAddress) - 1));
                            try {
                                clientSocket.close();
                            } catch (IOException e) {
                                denisLogger.error("Error closing socket: " + e.getMessage());
                            }
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

}
