package github.hacimertgokhan.denis;

import github.hacimertgokhan.logger.DenisLogger;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * Per-run activity log ({@code denis/denis-<timestamp>.log}). Optionally opens
 * a desktop terminal that tails the file; that is off by default because the
 * server usually runs headless (Docker, systemd) and the file is what matters.
 */
public class DenisTerminal {
    private static final DenisLogger log = new DenisLogger(DenisTerminal.class);
    // Safe on every filesystem: no ':' or spaces (the old locale-formatted
    // names could not even be checked out on Windows).
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT);

    private final boolean openWindow;
    private Process terminalProcess;
    private BufferedWriter writer;

    public DenisTerminal() {
        this(false);
    }

    public DenisTerminal(boolean openWindow) {
        this.openWindow = openWindow;
    }

    public void startLogTerminal(String logFilePath) {
        try {
            if (logFilePath == null || logFilePath.trim().isEmpty()) {
                logFilePath = "denis/denis-" + STAMP.format(LocalDateTime.now()) + ".log";
            }
            File logFile = new File(logFilePath);
            File parent = logFile.getAbsoluteFile().getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            if (!logFile.exists()) {
                logFile.createNewFile();
            }
            writer = new BufferedWriter(new FileWriter(logFile, true));
            if (openWindow) {
                openWindow(logFile.getAbsolutePath());
            }
        } catch (IOException e) {
            log.error("Could not open activity log: " + e.getMessage());
        }
    }

    private void openWindow(String logFilePath) {
        String os = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        try {
            if (os.contains("win")) {
                terminalProcess = new ProcessBuilder("cmd.exe", "/k", "type \"" + logFilePath + "\" & echo Logging started...").start();
            } else if (os.contains("mac")) {
                terminalProcess = new ProcessBuilder("osascript", "-e",
                        "tell application \"Terminal\" to do script \"tail -f " + logFilePath + "\"").start();
            } else {
                terminalProcess = new ProcessBuilder("gnome-terminal", "--", "tail", "-f", logFilePath).start();
            }
        } catch (IOException e) {
            log.warn("Log window could not be opened (headless?): " + e.getMessage());
        }
    }

    public void writeLog(String message) {
        try {
            if (writer != null) {
                writer.write(message);
                writer.newLine();
                writer.flush();
            }
        } catch (IOException e) {
            log.error("Could not write activity log: " + e.getMessage());
        }
    }

    public void closeLogTerminal() {
        try {
            if (writer != null) {
                writer.close();
            }
            if (terminalProcess != null) {
                terminalProcess.destroyForcibly();
            }
        } catch (IOException e) {
            log.error("Could not close activity log: " + e.getMessage());
        }
    }
}
