package github.hacimertgokhan.denisdb.protocols;

import java.util.HashMap;
import java.util.Map;

public class ConnectionInfo {
    private boolean isTelnetConnection;
    private int port;
    private String remoteAddress;
    private String protocolType;
    private String error;
    private Map<String, String> additionalDetails = new HashMap<>();

    public boolean isTelnetConnection() { return isTelnetConnection; }
    public void setTelnetConnection(boolean telnetConnection) {
        isTelnetConnection = telnetConnection;
    }

    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }

    public String getRemoteAddress() { return remoteAddress; }
    public void setRemoteAddress(String remoteAddress) {
        this.remoteAddress = remoteAddress;
    }

    public String getProtocolType() { return protocolType; }
    public void setProtocolType(String protocolType) {
        this.protocolType = protocolType;
    }

    public String getError() { return error; }
    public void setError(String error) { this.error = error; }

    public void addDetail(String key, String value) {
        additionalDetails.put(key, value);
    }

    public Map<String, String> getAdditionalDetails() {
        return additionalDetails;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        sb.append("Connection Details:\n");
        sb.append("Is Telnet: ").append(isTelnetConnection).append("\n");
        sb.append("Port: ").append(port).append("\n");
        sb.append("Remote Address: ").append(remoteAddress).append("\n");
        sb.append("Protocol: ").append(protocolType).append("\n");

        if (!additionalDetails.isEmpty()) {
            sb.append("\nAdditional Details:\n");
            additionalDetails.forEach((key, value) ->
                    sb.append(key).append(": ").append(value).append("\n"));
        }

        if (error != null) {
            sb.append("\nError: ").append(error).append("\n");
        }

        return sb.toString();
    }
}