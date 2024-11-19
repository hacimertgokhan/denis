package github.hacimertgokhan.denisdb;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Date;
import java.util.Locale;

public class DenisTerminal {
    private Process terminalProcess;
    private BufferedWriter writer;

    public void startLogTerminal(String logFilePath) {
        try {
            if (logFilePath == null || logFilePath.trim().isEmpty()) {
                logFilePath = "./denis/"+new Date().toLocaleString().toLowerCase(Locale.ROOT) +"-logs.txt";
            }
            File logFile = new File(logFilePath);
            logFile.getParentFile().mkdirs(); // Üst dizinleri oluştur
            if (!logFile.exists()) {
                logFile.createNewFile();
            }
            String os = System.getProperty("os.name").toLowerCase();
            if (os.contains("win")) {
                terminalProcess = Runtime.getRuntime().exec(
                        "cmd.exe /k type \"" + logFilePath + "\" & echo Logging started..."
                );
            } else if (os.contains("mac")) {
                terminalProcess = Runtime.getRuntime().exec(new String[]{
                        "osascript", "-e",
                        "tell application \"Terminal\" to do script \"tail -f " + logFilePath + "\""
                });
            } else { // Linux
                terminalProcess = Runtime.getRuntime().exec(
                        "gnome-terminal -- tail -f " + logFilePath
                );
            }
            writer = new BufferedWriter(new FileWriter(logFile, true));
        } catch (IOException e) {
            e.printStackTrace();
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
            e.printStackTrace();
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
            e.printStackTrace();
        }
    }

}
