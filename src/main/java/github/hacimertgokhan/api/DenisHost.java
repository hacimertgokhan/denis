package github.hacimertgokhan.api;

public class DenisHost {
    private String host;
    private int port;

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public DenisHost(String host, int port) {
        this.host = host;
        this.port = port;
    }
}
