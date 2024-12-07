package github.hacimertgokhan.denis.protocols.app;

import github.hacimertgokhan.denis.ConnectionInfo;

import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;

public class Telnet {
    private static final byte IAC = (byte) 255;
    private static final int BUFFER_SIZE = 1024;

    public static boolean isTelnetConnection(Socket socket) throws IOException {
        InputStream in = socket.getInputStream();
        socket.setSoTimeout(1000);

        byte[] buffer = new byte[BUFFER_SIZE];
        boolean isTelnet = false;

        try {
            int bytesRead = in.read(buffer);

            if (bytesRead > 0) {
                for (int i = 0; i < bytesRead - 1; i++) {
                    // Telnet IAC (Interpret As Command) baytını ara
                    if (buffer[i] == IAC) {
                        isTelnet = true;
                        break;
                    }
                }

                if (!isTelnet) {
                    for (int i = 0; i < bytesRead - 2; i++) {
                        if (buffer[i] == IAC &&
                                (buffer[i + 1] >= 251 && buffer[i + 1] <= 254)) {
                            isTelnet = true;
                            break;
                        }
                    }
                }
            }
        } catch (SocketTimeoutException e) {
            return false;
        } finally {
            socket.setSoTimeout(0);
        }

        return isTelnet;
    }

    public static ConnectionInfo analyzeConnection(Socket socket) {
        ConnectionInfo details = new ConnectionInfo();

        try {
            details.setTelnetConnection(isTelnetConnection(socket));
            details.setPort(socket.getPort());
            details.setRemoteAddress(socket.getInetAddress().getHostAddress());
            details.setProtocolType(details.isTelnetConnection() ? "TELNET over TCP" : "Pure TCP");
            if (details.isTelnetConnection()) {
                details.addDetail("Telnet Negotiation", "Protocol commands detected");
                details.addDetail("Transport Protocol", "TCP");
                details.addDetail("Application Protocol", "Telnet");
            }

        } catch (IOException e) {
            details.setError("Connection analysis failed: " + e.getMessage());
        }

        return details;
    }
}