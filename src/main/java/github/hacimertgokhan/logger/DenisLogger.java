package github.hacimertgokhan.logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.logging.ConsoleHandler;
import java.util.logging.FileHandler;
import java.util.logging.Formatter;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogManager;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

/**
 * Thin wrapper over {@code java.util.logging}. The JDK logger keeps the server
 * free of a logging framework dependency (important on small devices) while
 * still giving a console handler and a size-rotated file ({@code logs/denis.log}).
 *
 * <p>Configure with {@link #configure(String, String)} once at start-up; before
 * that, messages go to the console at INFO.
 */
public class DenisLogger {
    private static final String ROOT = "github.hacimertgokhan";
    private static final DateTimeFormatter TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT).withZone(ZoneId.systemDefault());
    private static volatile boolean configured;

    static {
        configure("info", null);
        configured = false;
    }

    private final Logger logger;

    public DenisLogger(Class<?> clazz) {
        logger = Logger.getLogger(clazz.getName());
    }

    /**
     * @param level   off | error | warn | info | debug | trace
     * @param logFile file to append to (rotated at 10 MB, 5 files kept); null for console only
     */
    public static synchronized void configure(String level, String logFile) {
        LogManager.getLogManager().reset();
        Logger root = Logger.getLogger(ROOT);
        root.setUseParentHandlers(false);
        for (Handler handler : root.getHandlers()) {
            root.removeHandler(handler);
            handler.close();
        }
        Level jul = parseLevel(level);
        root.setLevel(jul);

        Formatter formatter = new LineFormatter();
        ConsoleHandler console = new ConsoleHandler() {
            {
                setOutputStream(System.out);
            }
        };
        console.setFormatter(formatter);
        console.setLevel(jul);
        root.addHandler(console);

        if (logFile != null && !logFile.isBlank()) {
            try {
                Path path = Paths.get(logFile).toAbsolutePath();
                if (path.getParent() != null) {
                    Files.createDirectories(path.getParent());
                }
                FileHandler file = new FileHandler(path.toString().replace("%", "%%"), 10 * 1024 * 1024, 5, true);
                file.setFormatter(formatter);
                file.setLevel(jul);
                file.setEncoding("UTF-8");
                root.addHandler(file);
            } catch (IOException | RuntimeException e) {
                root.warning("Log file " + logFile + " could not be opened: " + e.getMessage());
            }
        }
        configured = true;
    }

    public static boolean isConfigured() {
        return configured;
    }

    static Level parseLevel(String level) {
        if (level == null) {
            return Level.INFO;
        }
        return switch (level.trim().toLowerCase(Locale.ROOT)) {
            case "off" -> Level.OFF;
            case "error", "severe" -> Level.SEVERE;
            case "warn", "warning" -> Level.WARNING;
            case "debug", "fine" -> Level.FINE;
            case "trace", "finest", "all" -> Level.FINEST;
            default -> Level.INFO;
        };
    }

    public void info(String msg) {
        logger.info(msg);
    }

    public void debug(String msg) {
        logger.fine(msg);
    }

    public boolean isDebugEnabled() {
        return logger.isLoggable(Level.FINE);
    }

    public void warn(String msg) {
        logger.warning(msg);
    }

    public void error(String msg) {
        logger.severe(msg);
    }

    public void error(String msg, Throwable error) {
        logger.log(Level.SEVERE, msg, error);
    }

    /** {@code 2026-09-23 20:06:19 INFO  [thread] Class - message} */
    private static final class LineFormatter extends Formatter {
        @Override
        public String format(LogRecord record) {
            String name = record.getLoggerName();
            int dot = name == null ? -1 : name.lastIndexOf('.');
            String shortName = dot >= 0 ? name.substring(dot + 1) : String.valueOf(name);
            StringBuilder sb = new StringBuilder(128);
            sb.append(TIME.format(Instant.ofEpochMilli(record.getMillis()))).append(' ');
            String level = levelName(record.getLevel());
            sb.append(level);
            for (int i = level.length(); i < 5; i++) {
                sb.append(' ');
            }
            sb.append(" [").append(Thread.currentThread().getName()).append("] ")
                    .append(shortName).append(" - ").append(formatMessage(record)).append(System.lineSeparator());
            if (record.getThrown() != null) {
                java.io.StringWriter trace = new java.io.StringWriter();
                record.getThrown().printStackTrace(new java.io.PrintWriter(trace));
                sb.append(trace);
            }
            return sb.toString();
        }

        private static String levelName(Level level) {
            if (level.intValue() >= Level.SEVERE.intValue()) {
                return "ERROR";
            }
            if (level.intValue() >= Level.WARNING.intValue()) {
                return "WARN";
            }
            if (level.intValue() >= Level.INFO.intValue()) {
                return "INFO";
            }
            if (level.intValue() >= Level.FINE.intValue()) {
                return "DEBUG";
            }
            return "TRACE";
        }
    }
}
