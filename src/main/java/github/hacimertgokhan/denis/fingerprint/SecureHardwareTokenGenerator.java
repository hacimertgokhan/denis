package github.hacimertgokhan.denis.fingerprint;

import java.security.MessageDigest;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class SecureHardwareTokenGenerator {

    private static final String OS = System.getProperty("os.name").toLowerCase();

    public static String generateSecureToken() {
        try {
            StringBuilder hardwareInfo = new StringBuilder();

            if (isWindows()) {
                String cpuId = executeCommand("wmic cpu get processorid");
                hardwareInfo.append(cpuId);
                String motherboardId = executeCommand("wmic baseboard get serialnumber");
                hardwareInfo.append(motherboardId);
                String biosId = executeCommand("wmic bios get serialnumber");
                hardwareInfo.append(biosId);
                String diskId = executeCommand("wmic diskdrive get serialnumber");
                hardwareInfo.append(diskId);
            } else if (isUnix()) {
                String cpuInfo = executeCommand("cat /proc/cpuinfo | grep 'Serial'");
                hardwareInfo.append(cpuInfo);
                String[] commands = {
                        "dmidecode -s system-serial-number",
                        "dmidecode -s baseboard-serial-number",
                        "dmidecode -s bios-version",
                        "lsblk --nodeps -no serial" // disk seri numarası
                };

                for (String command : commands) {
                    String result = executeCommand(command);
                    if (!result.isEmpty()) {
                        hardwareInfo.append(result);
                    }
                }
                if (hardwareInfo.length() < 10) {
                    String alternativeCpuInfo = executeCommand("cat /proc/cpuinfo | grep -i 'processor'");
                    String alternativeSystemInfo = executeCommand("uname -a");
                    hardwareInfo.append(alternativeCpuInfo).append(alternativeSystemInfo);
                }
            } else if (isMac()) {
                String systemInfo = executeCommand("system_profiler SPHardwareDataType");
                hardwareInfo.append(systemInfo);
                String serialNumber = executeCommand("ioreg -l | grep IOPlatformSerialNumber");
                hardwareInfo.append(serialNumber);
            }
            if (hardwareInfo.length() < 10) {
                hardwareInfo.append(System.getProperty("os.version"));
                hardwareInfo.append(System.getProperty("user.name"));
                hardwareInfo.append(System.getProperty("java.vendor"));
                hardwareInfo.append(Runtime.getRuntime().maxMemory());
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-512");
            byte[] hash = digest.digest(hardwareInfo.toString().getBytes());

            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }

            return hexString.toString();

        } catch (Exception e) {
            throw new RuntimeException("Token oluşturulurken hata oluştu: " + e.getMessage(), e);
        }
    }

    private static String executeCommand(String command) {
        try {
            Process process = Runtime.getRuntime().exec(command);
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));

            StringBuilder output = new StringBuilder();
            String line;
            boolean firstLine = true;

            while ((line = reader.readLine()) != null) {
                if (firstLine) {
                    firstLine = false;
                    continue;
                }
                if (!line.trim().isEmpty()) {
                    output.append(line.trim());
                }
            }

            return output.toString();
        } catch (Exception e) {
            return "";
        }
    }

    public static boolean validateToken(String token) {
        if (token == null || token.length() != 128) {
            return false;
        }
        return token.matches("[0-9a-f]+");
    }

    private static boolean isWindows() {
        return OS.contains("win");
    }

    private static boolean isUnix() {
        return OS.contains("nix") || OS.contains("nux") || OS.contains("aix");
    }

    private static boolean isMac() {
        return OS.contains("mac");
    }
}