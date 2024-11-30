package github.hacimertgokhan.denisdb.cli;
import picocli.CommandLine;
public class CLIMain {
    public static void main(String[] args) {
        int exitCode = new CommandLine(new DenisMan()).execute(args);
        System.exit(exitCode);
    }
}
