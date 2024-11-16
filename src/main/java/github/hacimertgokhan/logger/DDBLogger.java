package github.hacimertgokhan.logger;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

public class DDBLogger {
    final Logger logger;

    public DDBLogger(Class<?> clazz) {
        logger = LogManager.getLogger(clazz);
    }
    public void info(String msg) {
        logger.info(msg);
    }

    public void debug(String msg) {
        logger.debug(msg);
    }

    public void warn(String msg) {
        logger.warn(msg);
    }

    public void error(String msg) {
        logger.error(msg);
    }

}
