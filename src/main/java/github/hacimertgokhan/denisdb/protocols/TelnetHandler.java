package github.hacimertgokhan.denisdb.protocols;

import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;

public class TelnetHandler {
    public boolean isTelnetConnection(Socket socket) {
        try {
            socket.setSoTimeout(2000);
            InputStream input = socket.getInputStream();
            int firstByte = input.read();
            if (firstByte == 255) {
                return true;
            }
        } catch (SocketTimeoutException e) {
            System.err.println("Timeout occurred while checking for Telnet connection.");
        } catch (IOException e) {
            System.err.println("IOException occurred: " + e.getMessage());
        }
        return false;
    }
}
