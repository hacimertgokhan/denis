package github.hacimertgokhan.denisdb.cli;

import github.hacimertgokhan.denisdb.CreateSecureToken;
import github.hacimertgokhan.denisdb.language.DenisLanguage;
import github.hacimertgokhan.json.JsonFile;
import org.json.JSONObject;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.util.List;
import java.util.Scanner;

@Command(name = "ddb", description = "Greet the user with a message and keep asking for names.")
public class DenisMan implements Runnable {
    static JsonFile ddb = new JsonFile("ddb.json");

    @Option(names = {"--version"}, description = "Gets current ddb version.")
    private boolean version;

    @Option(names = {"--about"}, description = "Get more information about ddb.")
    private boolean about;

    @Option(names = {"--exit"}, description = "Exits from denis man mode.")
    private boolean exit;

    @Option(names = {"--mu"}, description = "Shows ddb memory usage.")
    private boolean memoryUsage;
    @Option(names = {"--lm"}, description = "Shows ddb memory usage (More detail).")
    private boolean listmemoryUsage;

    @Option(names = {"--help"}, description = "Shows help commands.")
    private boolean help;

    @Command(name = "token", description = "Manage storage tokens.")
    public void token(
            @Option(names = {"-l"}, description = "List all tokens") boolean list,
            @Option(names = {"-c"}, description = "Create a new token") boolean create,
            @Option(names = {"-d"}, description = "Delete a token") boolean delete,
            @Option(names = {"-i"}, description = "Show token details like last login date.") boolean info) {

        if (list) {
            System.out.println("Listing all tokens...");
        } else if (create) {
            System.out.println("Creating a new token...");
        } else if (delete) {
            System.out.println("Deleting token...");
        } else if (info) {
            System.out.println("Showing token info...");
        }
    }

    @Option(names = {"--opt", "-max-token-size"}, description = "Set the maximum number of tokens", paramLabel = "<integer>")
    private Integer maxTokenSize;

    @Override
    public void run() {
        Scanner scanner = new Scanner(System.in);
        DenisLanguage denisLanguage = new DenisLanguage();
        while (true) {
            System.out.print("denis: ");
            String command = scanner.nextLine().trim();

            if (command.equalsIgnoreCase("--exit")) {
                System.out.println("Goodbye!");
                break;
            }

            if (command.equalsIgnoreCase("--lm")) {
                Runtime runtime = Runtime.getRuntime();
                MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
                System.out.println("Memory monitoring started. Type '--finish' to stop.");
                while (true) {
                    long totalMemory = runtime.totalMemory();
                    long freeMemory = runtime.freeMemory();
                    long usedMemory = totalMemory - freeMemory;
                    MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
                    System.out.println("------------------------------");
                    System.out.println("Runtime Memory Usage:");
                    System.out.println("  Total Memory: " + (totalMemory / 1024 / 1024) + " MB");
                    System.out.println("  Free Memory: " + (freeMemory / 1024 / 1024) + " MB");
                    System.out.println("  Used Memory: " + (usedMemory / 1024 / 1024) + " MB");
                    System.out.println("Heap Memory Usage:");
                    System.out.println("  Initial: " + (heapUsage.getInit() / 1024 / 1024) + " MB");
                    System.out.println("  Used: " + (heapUsage.getUsed() / 1024 / 1024) + " MB");
                    System.out.println("  Committed: " + (heapUsage.getCommitted() / 1024 / 1024) + " MB");
                    System.out.println("  Max: " + (heapUsage.getMax() / 1024 / 1024) + " MB");
                    System.out.println("------------------------------");
                    try {
                        if (System.in.available() > 0) { // Giriş var mı kontrol et
                            String input = scanner.nextLine();
                            if (input.equalsIgnoreCase("--finish")) {
                                System.out.println("Exiting memory monitoring...");
                                break; // Döngüyü sonlandır
                            }
                        }
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }

                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
            }

            if (command.equalsIgnoreCase("--version")) {
                System.out.println("v0.001a");
            } else if (command.equalsIgnoreCase("--about")) {
                try {
                    System.out.println(denisLanguage.getLanguageFile().readJson().get("created_by"));
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            } else if (command.equalsIgnoreCase("--mu")) {
                Runtime runtime = Runtime.getRuntime();
                long totalMemory = runtime.totalMemory();
                long freeMemory = runtime.freeMemory();
                long usedMemory = totalMemory - freeMemory;
                System.out.println("Denis Cache Based Database Current Memory Usage: ");
                System.out.println(" - Total memory: " + (totalMemory / 1024 / 1024) + " MB");
                System.out.println(" - Empty memory: " + (freeMemory / 1024 / 1024) + " MB");
                System.out.println(" - Used memory: " + (usedMemory / 1024 / 1024) + " MB");
            } else if (command.startsWith("--token")) {
                processTokenCommand(command);
            } else if (command.startsWith("--help")) {
                help(denisLanguage);
            } else if (command.startsWith("--opt")) {
                if (command.contains("-smts")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 1) {
                        try {
                            int maxSize = Integer.parseInt(parts[1]);
                            System.out.println("Setting maximum token size to: " + maxSize);
                        } catch (NumberFormatException e) {
                            System.out.println("Invalid number for maximum token size.");
                        }
                    }
                } else if (command.contains("-swd")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 1) {
                        try {
                            String answ = (parts[1]);
                            if (answ != null) {
                                System.out.println("Setting maximum token size to: " + answ);
                            }
                        } catch (NumberFormatException e) {
                            System.out.println("Invalid number for maximum token size.");
                        }
                    }
                } else if (command.contains("-lang")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 2) {
                        if (parts[2].equalsIgnoreCase("-slfs")) {
                            try {
                                denisLanguage.setSelected(parts[3]);
                                System.out.println(String.format("Language changed for active session: %s", parts[3]));
                            } catch (NumberFormatException e) {
                                System.out.println("Invalid string type.");
                            }
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else {
                    help(denisLanguage);
                }
            } else {
                System.out.println("Unknown command. Use --help for more information.");
            }
        }

        scanner.close();
    }

    private void help(DenisLanguage denisLanguage) {
        List<String> list;
        try {
            list = denisLanguage.getLanguageFile().getList("help");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        for(String s : list) {
            System.out.println(s);
        }
    }

    private void processTokenCommand(String command) {
        if (command.contains("-l")) {
            System.out.println("Listing all tokens...");
        } else if (command.contains("-c")) {
            String newToken = new CreateSecureToken().getToken();
            try {
                JsonFile projectFile = new JsonFile("storage/" + newToken + ".json");
                if (!projectFile.fileExists()) {
                    projectFile.createEmptyJson();
                    JSONObject initialData = new JSONObject();
                    initialData.put("storage", new JSONObject());
                    projectFile.writeJson(initialData);
                }
                ddb.appendToArray("tokens", newToken);
                System.out.println("Project created successfully! Token: " + newToken);
            } catch (IOException e) {
                System.out.println("Error saving new token: " + e.getMessage());
                System.out.println("ERROR: Could not create project");
            }
        } else if (command.contains("-i")) {
            System.out.println("Showing token info...");
        } else {
            System.out.println("Unknown token command.");
        }
    }


}

