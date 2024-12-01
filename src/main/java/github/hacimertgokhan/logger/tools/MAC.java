package github.hacimertgokhan.logger.tools;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public class MAC {
    public static String getMacAddress(InetAddress localhost) {
        try {
            NetworkInterface networkInterface = NetworkInterface.getByInetAddress(localhost);
            if (networkInterface == null) {
                return null;
            }
            byte[] macAddress = networkInterface.getHardwareAddress();

            if (macAddress == null) {
                return null;
            }
            StringBuilder macAddressStr = new StringBuilder();
            for (byte b : macAddress) {
                macAddressStr.append(String.format("%02X", b)).append(":");
            }
            macAddressStr.setLength(macAddressStr.length() - 1);
            return macAddressStr.toString();
        } catch (SocketException e) {
            e.printStackTrace();
            return null;
        }
    }

    public static String generateFingerprint(String cpuSerial, String motherboardSerial, String macAddress, String salt) throws NoSuchAlgorithmException {
        String dataToHash = cpuSerial + motherboardSerial + macAddress + salt;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(dataToHash.getBytes(StandardCharsets.UTF_8));
        StringBuilder hexString = new StringBuilder();
        for (byte b : hash) {
            hexString.append(String.format("%02x", b));
        }

        return hexString.toString();
    }
}
