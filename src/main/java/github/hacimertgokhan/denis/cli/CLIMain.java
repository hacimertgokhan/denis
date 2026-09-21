package github.hacimertgokhan.denis.cli;

import picocli.CommandLine;

public class CLIMain {
    public static void main(String[] args) {
        // Keep stdout clean for the command output; logs go to stderr at warn level.
        if (System.getProperty("denis.log.level") == null) {
            System.setProperty("denis.log.level", "warn");
        }
        int exitCode = new CommandLine(new DenisMan()).execute(args);
        System.exit(exitCode);
    }
}
