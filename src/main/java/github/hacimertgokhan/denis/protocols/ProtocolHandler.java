package github.hacimertgokhan.denis.protocols;

import github.hacimertgokhan.denis.protocols.app.Telnet;

public class ProtocolHandler {

    public static class ApplicationProtocols {

        public static class TelnetApp {
            Telnet telnet = new Telnet();

            public github.hacimertgokhan.denis.protocols.app.Telnet getTelnet() {
                return telnet;
            }

            public void setTelnet(github.hacimertgokhan.denis.protocols.app.Telnet telnet) {
                this.telnet = telnet;
            }
        }
    }

}
