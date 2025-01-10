package github.hacimertgokhan.setup;

import java.io.*;
import java.net.URL;
import java.nio.channels.Channels;
import java.nio.channels.ReadableByteChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class SetupTool {
    private static final String WINDOWS_JDK_URL = "https://download.oracle.com/java/17/latest/jdk-17_windows-x64_bin.exe";
    private static final String LINUX_JDK_URL = "https://download.oracle.com/java/17/latest/jdk-17_linux-x64_bin.tar.gz";
    private static final String MAC_JDK_URL = "https://download.oracle.com/java/17/latest/jdk-17_macos-x64_bin.dmg";

    private final String osName;
    private final String osArch;
    private final Path setupDir;

    public SetupTool() {
        this.osName = System.getProperty("os.name").toLowerCase();
        this.osArch = System.getProperty("os.arch").toLowerCase();
        this.setupDir = Paths.get(System.getProperty("user.dir"), "setup");
    }

    public void startSetup() {
        try {
            System.out.println("Starting setup process...");
            createSetupDirectory();
            downloadJDK();
            createStartupScript();
            System.out.println("Setup completed successfully!");
        } catch (Exception e) {
            System.err.println("Setup failed: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void createSetupDirectory() throws IOException {
        if (!Files.exists(setupDir)) {
            Files.createDirectories(setupDir);
            System.out.println("Created setup directory at: " + setupDir);
        }
    }

    private void downloadJDK() throws IOException {
        String jdkUrl = getJDKDownloadUrl();
        Path downloadPath = setupDir.resolve("jdk17.exe");

        System.out.println("Downloading JDK 17...");
        URL url = new URL(jdkUrl);
        try (ReadableByteChannel channel = Channels.newChannel(url.openStream());
             FileOutputStream fos = new FileOutputStream(downloadPath.toFile())) {
            fos.getChannel().transferFrom(channel, 0, Long.MAX_VALUE);
        }
        System.out.println("JDK 17 downloaded successfully!");
    }

    private String getJDKDownloadUrl() {
        if (isWindows()) {
            return WINDOWS_JDK_URL;
        } else if (isLinux()) {
            return LINUX_JDK_URL;
        } else if (isMac()) {
            return MAC_JDK_URL;
        }
        throw new UnsupportedOperationException("Unsupported operating system: " + osName);
    }

    private void createStartupScript() throws IOException {
        if (isWindows()) {
            createWindowsScript();
        } else {
            createLinuxScript();
        }
    }

    private void createWindowsScript() throws IOException {
        Path batchFile = setupDir.resolve("ddb.bat");
        if (!Files.exists(batchFile)) {
            String batchContent = "@echo off\n"
                    + "set JAVA_HOME=%ProgramFiles%\\Java\\jdk-17\n"
                    + "set PATH=%JAVA_HOME%\\bin;%PATH%\n"
                    + "java -jar app.jar %*\n"
                    + "pause";
            Files.write(batchFile, batchContent.getBytes());
            System.out.println("Created Windows startup script: ddb.bat");
        } else {
            System.out.println("Verifying Windows startup script...");
        }
    }

    private void createLinuxScript() throws IOException {
        Path shellScript = setupDir.resolve("ddb.sh");
        if (!Files.exists(shellScript)) {
            String shellContent = "#!/bin/bash\n"
                    + "export JAVA_HOME=/usr/lib/jvm/java-17\n"
                    + "export PATH=$JAVA_HOME/bin:$PATH\n"
                    + "java -jar app.jar \"$@\"\n";
            Files.write(shellScript, shellContent.getBytes());
            makeExecutable(shellScript);
            System.out.println("Created Linux startup script: ddb.sh");
        } else {
            System.out.println("Verifying Linux startup script...");
        }
    }

    private void makeExecutable(Path file) throws IOException {
        file.toFile().setExecutable(true, true);
    }

    private boolean isWindows() {
        return osName.contains("win");
    }

    private boolean isLinux() {
        return osName.contains("nix") || osName.contains("nux") || osName.contains("aix");
    }

    private boolean isMac() {
        return osName.contains("mac");
    }

    // Main method for testing
    public static void main(String[] args) {
        SetupTool setupTool = new SetupTool();
        if (args.length > 0 && args[0].equals("--start-setup")) {
            setupTool.startSetup();
        } else {
            System.out.println("Use --start-setup to begin the setup process");
        }
    }
}