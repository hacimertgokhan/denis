package github.hacimertgokhan.denis.fingerprint;

import java.io.FileNotFoundException;
import java.io.FileOutputStream;

public class FingerprintStore {

    private FileOutputStream fps;

    public FileOutputStream create() {
        try {
            return new FileOutputStream("fingerprints.dat");
        } catch (FileNotFoundException e) {
            throw new RuntimeException(e);
        }
    }



}
