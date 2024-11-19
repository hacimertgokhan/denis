package github.hacimertgokhan.proto;

import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

public class ReadProtoFile {
    public void Read(String filePath) {
        File file = new File(filePath);
        try (FileInputStream fis = new FileInputStream(file);
             DataInputStream dis = new DataInputStream(fis)) {
            long fileLength = file.length();
            byte[] data = new byte[(int) fileLength];
            dis.readFully(data);
            String content = new String(data, StandardCharsets.UTF_8);
            System.out.println("File Content: " + content);
            ByteBuffer buffer = ByteBuffer.wrap(data);
            while (buffer.hasRemaining()) {
                int intValue = buffer.getInt();
                System.out.println("Read Integer: " + intValue);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
