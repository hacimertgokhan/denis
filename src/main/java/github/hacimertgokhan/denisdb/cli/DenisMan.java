package github.hacimertgokhan.denisdb.cli;

import github.hacimertgokhan.denisdb.CreateSecureToken;
import github.hacimertgokhan.denisdb.language.DenisLanguage;
import github.hacimertgokhan.json.JsonFile;
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
                try {
                    System.out.println(denisLanguage.getLanguageFile().readJson().get("monitoring-started"));
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
                while (true) {
                    try {
                        if (System.in.available() > 0) { // Giriş var mı kontrol et
                            String input = scanner.nextLine();
                            if (input.equalsIgnoreCase("--finish")) {
                                System.out.println(new DenisLanguage().getLanguageFile().readJson().get("exiting_memory_monitoring"));
                                break; // Döngüyü sonlandır
                            }
                        }
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                    listenMemoryUsage(denisLanguage, runtime, memoryBean);
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
                listenMemoryUsage(denisLanguage, runtime);
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
                            try {
                                System.out.println(String.format(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("max-token-size")), maxSize));
                            } catch (IOException e) {
                                throw new RuntimeException(e);
                            }
                        } catch (NumberFormatException e) {
                            try {
                                System.out.println(new DenisLanguage().getLanguageFile().readJson().get("invalid-parametre"));
                            } catch (IOException a) {
                                throw new RuntimeException(a);
                            }
                        }
                    }
                } else if (command.contains("-swd")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 1) {
                        try {
                            String answ = (parts[1]);
                            if (answ != null) {
                                try {
                                    System.out.println(String.format(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("starts-with-details")), answ));
                                } catch (IOException e) {
                                    throw new RuntimeException(e);
                                }
                            }
                        } catch (NumberFormatException e) {
                            try {
                                System.out.println(new DenisLanguage().getLanguageFile().readJson().get("invalid-parametre"));
                            } catch (IOException a) {
                                throw new RuntimeException(a);
                            }
                        }
                    }
                } else if (command.contains("-lang")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 2) {
                        if (parts[2].equalsIgnoreCase("-slfs")) {
                            try {
                                denisLanguage.setSelected(parts[3]);
                                if (parts[3].equalsIgnoreCase("tr") || parts[3].equalsIgnoreCase("fi") || parts[3].equalsIgnoreCase("en") || parts[3].equalsIgnoreCase("fr") || parts[3].equalsIgnoreCase("de") || parts[3].equalsIgnoreCase("da") || parts[3].equalsIgnoreCase("el") || parts[3].equalsIgnoreCase("es")) {
                                    try {
                                        System.out.println(String.format(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("language-changed")), parts[3]));
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                } else {
                                    try {
                                        System.out.println(new DenisLanguage().getLanguageFile().readJson().get("invalid-parametre"));
                                    } catch (IOException e) {
                                        throw new RuntimeException(e);
                                    }
                                }
                            } catch (NumberFormatException e) {
                                try {
                                    System.out.println(new DenisLanguage().getLanguageFile().readJson().get("invalid-parametre"));
                                } catch (IOException a) {
                                    throw new RuntimeException(a);
                                }
                            }
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else {
                    help(denisLanguage);
                }
            } else {
                try {
                    System.out.println(new DenisLanguage().getLanguageFile().readJson().get("cli-help"));
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
        }

        scanner.close();
    }

    private void listenMemoryUsage(DenisLanguage denisLanguage, Runtime runtime, MemoryMXBean memoryBean) {
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();
        long usedMemory = totalMemory - freeMemory;
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();
        List<String> list;
        try {
            list = denisLanguage.getLanguageFile().getList("listen-memory");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        for(String s : list) {
            System.out.println(s
                    .replace("<total_memory>", String.valueOf((totalMemory / 1024 / 1024)))
                    .replace("<free_memory>", String.valueOf((freeMemory / 1024 / 1024)))
                    .replace("<used_memory>", String.valueOf((usedMemory / 1024 / 1024)))
                    .replace("<heap_usage_initial>", String.valueOf((heapUsage.getInit() / 1024 / 1024)))
                    .replace("<heap_usage_max>", String.valueOf((heapUsage.getMax() / 1024 / 1024)))
                    .replace("<heap_usage_used>", String.valueOf((usedMemory / 1024 / 1024)))
                    .replace("<heap_usage_free>", String.valueOf((freeMemory / 1024 / 1024)))
            );
        }
    }

    private void listenMemoryUsage(DenisLanguage denisLanguage, Runtime runtime) {
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();
        long usedMemory = totalMemory - freeMemory;
        List<String> list;
        try {
            list = denisLanguage.getLanguageFile().getList("listen-memory");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        for(String s : list) {
            System.out.println(s
                    .replace("<total_memory>", String.valueOf((totalMemory / 1024 / 1024)))
                    .replace("<free_memory>", String.valueOf((freeMemory / 1024 / 1024)))
                    .replace("<used_memory>", String.valueOf((usedMemory / 1024 / 1024)))
                    .replace("<heap_usage_used>", String.valueOf((usedMemory / 1024 / 1024)))
                    .replace("<heap_usage_free>", String.valueOf((freeMemory / 1024 / 1024)))
            );
        }
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
                /*
                    JsonFile projectFile = new JsonFile("storage/" + newToken + ".json");
                    if (!projectFile.fileExists()) {
                        projectFile.createEmptyJson();
                        JSONObject initialData = new JSONObject();
                        initialData.put("storage", new JSONObject());
                        projectFile.writeJson(initialData);
                    }
                 */
                ddb.appendToArray("tokens", newToken);
                System.out.println(String.format(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("token_created_successfuly")), newToken));
            } catch (IOException e) {
                try {
                    System.out.println(String.format(String.valueOf(new DenisLanguage().getLanguageFile().readJson().get("token_creation_error")), e.getMessage()));
                } catch (IOException ex) {
                    throw new RuntimeException(ex);
                }
            }
        } else if (command.contains("-i")) {
            System.out.println("Showing token info...");
        } else {
            try {
                System.out.println(new DenisLanguage().getLanguageFile().readJson().get("cli-help"));
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
    }


}

