package github.hacimertgokhan.api;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;

public class DenisDB {
    public DenisHost denisHost;


    public DenisDB(DenisHost denisHost) {
        this.denisHost=denisHost;
    }

    public String command(String command) {
        try (Socket socket = new Socket(denisHost.getHost(), denisHost.getPort());
             PrintWriter out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream()), true);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()))) {
            out.println(command);
            return in.readLine();
        } catch (Exception e) {
            e.printStackTrace();
            return "ERROR: " + e.getMessage();
        }
    }


}
