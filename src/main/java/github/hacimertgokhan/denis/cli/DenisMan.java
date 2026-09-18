package github.hacimertgokhan.denis.cli;

import github.hacimertgokhan.denis.CreateSecureToken;
import github.hacimertgokhan.denis.language.DenisLanguage;
import github.hacimertgokhan.denis.sections.Access;
import github.hacimertgokhan.denis.sections.Accessibility;
import github.hacimertgokhan.denis.sections.group.Group;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.readers.DenisProperties;
import github.hacimertgokhan.readers.DenisToml;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.util.*;

@Command(name = "denis", description = "Manage Denis Database from the command line.")
public class DenisMan implements Runnable {
    static JsonFile ddb = new JsonFile("ddb.json");

    @Option(names = {"--version"}, description = "Gets current ddb version.")
    private boolean version;

    @Option(names = {"--about"}, description = "Get more information about ddb.")
    private boolean about;

    @Option(names = {"--exit"}, description = "Exits from denis man mode.")
    private boolean exit;

    @Option(names = {"--access"}, description = "Manage everything about access tokens and groups.")
    private boolean access;

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
            try {
                List<String> tokens = ddb.tokenList();
                if (tokens.isEmpty()) {
                    System.out.println("No tokens found.");
                    return;
                }
                tokens.forEach(System.out::println);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        } else if (create) {
            processTokenCommand("--token -c");
        } else if (delete) {
            System.out.println("Token delete is not implemented yet.");
        } else if (info) {
            System.out.println("Token info is not implemented yet.");
        } else {
            System.out.println("Usage: denis cli token [-l|-c|-d|-i]");
        }
    }

    /**
     * Non-interactive group management, for scripts and containers:
     * <pre>
     *   denis cli group create crm                 # password is generated and printed
     *   denis cli group create crm -p s3cret       # password supplied (stored hashed only)
     *   denis cli group create crm --json          # {"group":"crm","password":"..."}
     *   denis cli group list
     *   denis cli group test crm s3cret            # exit code 0 when the login works
     * </pre>
     */
    @Command(name = "group", description = "Manage login groups (LIN) without the interactive shell.")
    public int group(
            @Parameters(index = "0", paramLabel = "<create|list|test>", description = "Action") String action,
            @Parameters(index = "1", arity = "0..1", paramLabel = "<name>", description = "Group name") String name,
            @Parameters(index = "2", arity = "0..1", paramLabel = "<password>", description = "Password (test only)") String testPassword,
            @Option(names = {"-p", "--password"}, paramLabel = "<password>", description = "Password for create; generated when omitted") String password,
            @Option(names = {"--json"}, description = "Machine readable output") boolean json) {
        GroupManager manager = new GroupManager();
        try {
            switch (action.toLowerCase(Locale.ROOT)) {
                case "create" -> {
                    if (name == null) {
                        System.err.println("Usage: denis cli group create <name> [-p <password>] [--json]");
                        return 2;
                    }
                    GroupManager.CreatedGroup created = manager.create(name, password);
                    if (json) {
                        System.out.println(new org.json.JSONObject()
                                .put("group", created.name())
                                .put("password", created.password())
                                .put("generated", created.generatedPassword()));
                    } else if (created.generatedPassword()) {
                        System.out.printf("Group %s created.%n # Password: %s%n", created.name(), created.password());
                    } else {
                        System.out.printf("Group %s created.%n", created.name());
                    }
                    return 0;
                }
                case "list" -> {
                    List<String> groups = manager.list();
                    if (json) {
                        System.out.println(new org.json.JSONArray(groups));
                    } else if (groups.isEmpty()) {
                        System.out.println("No groups found.");
                    } else {
                        groups.forEach(System.out::println);
                    }
                    return 0;
                }
                case "test" -> {
                    if (name == null || testPassword == null) {
                        System.err.println("Usage: denis cli group test <name> <password>");
                        return 2;
                    }
                    boolean ok = manager.verify(name, testPassword);
                    if (json) {
                        System.out.println(new org.json.JSONObject().put("group", name).put("ok", ok));
                    } else {
                        System.out.println(ok ? "Test successful." : "Login failed: unknown group or wrong password.");
                    }
                    return ok ? 0 : 1;
                }
                default -> {
                    System.err.println("Unknown action: " + action + " (create|list|test)");
                    return 2;
                }
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            System.err.println(e.getMessage());
            return 1;
        } catch (IOException e) {
            System.err.println("Could not write denis.toml: " + e.getMessage());
            return 1;
        }
    }

    @Option(names = {"--opt", "-max-token-size"}, description = "Set the maximum number of tokens", paramLabel = "<integer>")
    private Integer maxTokenSize;

    @Override
    public void run() {
        DenisLanguage denisLanguage = new DenisLanguage();
        if (version) {
            System.out.println("Denis Database " + getVersion());
            return;
        }
        if (about) {
            try {
                System.out.println(denisLanguage.getLanguageFile().readJson().get("created_by"));
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            return;
        }
        if (memoryUsage) {
            listenMemoryUsage(denisLanguage, Runtime.getRuntime());
            return;
        }
        if (help) {
            help(denisLanguage);
            return;
        }

        Scanner scanner = new Scanner(System.in);
        while (true) {
            System.out.print("denis: ");
            String command = scanner.nextLine().trim();

            if (command.equalsIgnoreCase("--exit")) {
                System.out.println("Goodbye!");
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    System.out.println("\nShutting down gracefully...");
                }));
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
                System.out.println("Denis Database " + getVersion());
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
            } else if (command.startsWith("--access")) {
                if (command.contains("-cng")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 2) {
                        try {
                            GroupManager.CreatedGroup created = new GroupManager().create(parts[2], null);
                            System.out.printf("Group %s created.%n # Password: %s%n", created.name(), created.password());
                        } catch (IllegalArgumentException | IllegalStateException e) {
                            System.out.println(e.getMessage());
                        } catch (IOException e) {
                            throw new RuntimeException(e);
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else if (command.contains("-test")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 3) {
                        String group = parts[2];
                        String pawd = parts[3];
                        Group groupHandler = new Group(group);
                        if (groupHandler.isExists()) {
                            boolean log_in = groupHandler.in(pawd);
                            if (log_in) {
                                System.out.println("Test successfull.");
                            } else {
                                System.out.println("Incorrect hash mapping or incorrect salt encoding.");
                            }
                        } else {
                            System.out.printf("Group %s not found.\n", parts[2]);
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else if (command.contains("-l")) {
                    Accessibility accessibility = new Accessibility(true);
                } else if (command.contains("-astg")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 3) {
                        String group = parts[2];
                        String storage_section = parts[3];
                        Group groupHandler = new Group(group);
                        if (groupHandler.isExists()) {
                            boolean add_group = groupHandler.addAccessibility(group, storage_section);
                            if (add_group) {
                                System.out.println(String.format("%s added to %s", storage_section, group));
                            } else {
                                System.out.println("The value already exists in the accessibility list.");
                            }
                        } else {
                            System.out.printf("Group %s not found.\n", parts[2]);
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else if (command.contains("-rsfg")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 3) {
                        String group = parts[2];
                        String storage_section = parts[3];
                        Group groupHandler = new Group(group);
                        if (groupHandler.isExists()) {
                            boolean rem_group = groupHandler.removeAccessibility(group, storage_section);
                            if (rem_group) {
                                System.out.println(String.format("%s removed from %s", storage_section, group));
                            } else {
                                System.out.println("The value doesn't exist in the accessibility list.");
                            }
                        } else {
                            System.out.printf("Group %s not found.\n", parts[2]);
                        }
                    } else {
                        help(denisLanguage);
                    }
                } else if (command.contains("-aa")) {
                    String[] parts = command.split(" ");
                    if (parts.length > 2) {
                        Group group = new Group(parts[2]);
                        if (group.isExists()) {
                            Access access = new Access(parts[2], group.getAccessList());
                            System.out.printf("Group: %s\n", parts[2]);
                            for (String a : group.getAccessList()) {
                                System.out.printf("|-> %s\n", a);
                            }
                        } else {
                            System.out.printf("Group %s not found.\n", parts[2]);
                        }
                    } else {
                        Accessibility accessibility = new Accessibility(false);
                    }
                } else {
                    help(denisLanguage);
                }
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
                        } else if (parts[2].equalsIgnoreCase("-slfg")) {
                            try {
                                denisLanguage.setSelected(parts[3]);
                                DenisProperties denisProperties = new DenisProperties();
                                denisProperties.setProperty("language", parts[3]);
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

    private String getVersion() {
        String version = DenisMan.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }


}
