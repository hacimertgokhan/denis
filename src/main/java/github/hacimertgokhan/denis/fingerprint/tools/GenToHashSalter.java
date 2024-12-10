package github.hacimertgokhan.denis.fingerprint.tools;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

public class GenToHashSalter {

    public String generateSalt() {
        SecureRandom secureRandom = new SecureRandom();
        byte[] salt = new byte[64];
        secureRandom.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }


    public String generatePwd() {
        SecureRandom secureRandom = new SecureRandom();
        byte[] salt = new byte[16];
        secureRandom.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    public boolean verifyPassword(String inputPassword, String storedSalt, String storedHash) {
        String inputHash = hashPassword(inputPassword, storedSalt);
        return storedHash.equals(inputHash);
    }

    public String hashPassword(String password, String salt) {
        MessageDigest md = null;
        try {
            md = MessageDigest.getInstance("SHA-512");
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
        String saltedPassword = salt + password;
        byte[] hashedBytes = md.digest(saltedPassword.getBytes());
        return Base64.getEncoder().encodeToString(hashedBytes);
    }

}
