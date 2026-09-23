package github.hacimertgokhan.denis.cli;

import picocli.CommandLine;

/** {@code denis cli ...}: runs a management command, or the interactive shell without arguments. */
public class CLIMain {
    public static void main(String[] args) {
        int exitCode = new CommandLine(new DenisMan())
                .setCaseInsensitiveEnumValuesAllowed(true)
                .execute(args);
        if (args.length > 0 || exitCode != 0) {
            System.exit(exitCode);
        }
    }
}
