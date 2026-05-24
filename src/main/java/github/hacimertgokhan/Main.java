package github.hacimertgokhan;

import github.hacimertgokhan.denis.DenisTerminal;
import github.hacimertgokhan.denis.DenisClient;
import github.hacimertgokhan.denis.CreateSecureToken;
import github.hacimertgokhan.denis.calculators.ThreadPoolCalculator;
import github.hacimertgokhan.denis.cli.CLIMain;
import github.hacimertgokhan.denis.fingerprint.PawdStore;
import github.hacimertgokhan.denis.language.DenisLanguage;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.readers.DenisProperties;
import github.hacimertgokhan.readers.DenisToml;

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
    static boolean delogg = Boolean.parseBoolean(denisProperties.getProperty("use-delogg"));
    static boolean swd = Boolean.parseBoolean(denisProperties.getProperty("start-with-details"));
    static int PORT = Integer.parseInt(denisProperties.getProperty("ddb-port"));
    static String host = denisProperties.getProperty("ddb-address");
    static JsonFile ddb = new JsonFile("ddb.json");
    static ThreadPoolCalculator threadPoolCalculator = new ThreadPoolCalculator();
    static final int THREAD_POOL_SIZE = threadPoolCalculator.calculateCacheDatabaseThreads(0.7, 0.3);
    static ExecutorService executor = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
    static ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();
    static final int MAX_CONNECTIONS_PER_IP = Integer.parseInt(denisProperties.getProperty("max-connections-per-ip"));
    static ConcurrentHashMap<InetAddress, Integer> ipConnectionCount = new ConcurrentHashMap<>();
    static DenisToml denisToml = new DenisToml("denis.toml");

    public static void main(String[] args) {
        if (args.length > 0) {
            String command = args[0].toLowerCase(Locale.ROOT);
            if (command.equals("cli") || command.equals("shell") || command.equals("tools")) {
                CLIMain.main(Arrays.copyOfRange(args, 1, args.length));
                return;
            }
            if (command.equals("server") || command.equals("start")) {
                startServer();
                return;
            }
            if (command.equals("--version") || command.equals("version")) {
                System.out.println("Denis Database " + getVersion());
                return;
            }
            if (command.equals("--help") || command.equals("help")) {
                printUsage();
                return;
            }
        }
        startServer();
    }

    private static void startServer() {
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
        denisLogger.info("Checking pawd.dat file.");
        PawdStore pawdStore = new PawdStore();
        pawdStore.loadFromFile();
        denisLogger.info(String.format("Thread Pool Size %s", String.valueOf(THREAD_POOL_SIZE)));
        handleUseMode();
    }

    private static void printUsage() {
        System.out.println("Denis Database " + getVersion());
        System.out.println("Usage:");
        System.out.println("  denis server        Start database server");
        System.out.println("  denis cli           Open management shell");
        System.out.println("  denis cli --help    Show CLI commands");
        System.out.println("  denis --version     Show version");
    }

    private static String getVersion() {
        String version = Main.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }

    private static String resolveMainToken() {
        String token = denisProperties.getProperty("ddb-main-token");
        if (token != null && token.length() == 128) {
            return token;
        }

        String generatedToken = new CreateSecureToken().getToken();
        denisProperties.setProperty("ddb-main-token", generatedToken);
        return generatedToken;
    }

    private static void handleUseMode() {
        String token = resolveMainToken();
        if (token.length() == 128) {
            try (ServerSocket serverSocket = new ServerSocket(PORT)) {
                List<String> swdList;
                try {
                    swdList = new DenisLanguage().getLanguageFile().getList("startup-port-and-token-information");
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
                for(String s : swdList) {
                    denisLogger.info(s.replace("<port>", String.valueOf(PORT)).replace("<token>", token));
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
                    int currentConnections = ipConnectionCount.getOrDefault(clientAddress, Integer.valueOf(0));
                    if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
                        denisLogger.warn("Connection limit reached for IP address: " + clientAddress);
                        clientSocket.close();
                        continue;
                    }
                    ipConnectionCount.put(clientAddress, Integer.valueOf(currentConnections + 1));
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
                            ipConnectionCount.put(clientAddress, Integer.valueOf(Math.max(0, ipConnectionCount.get(clientAddress) - 1)));
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
