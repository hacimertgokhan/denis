package github.hacimertgokhan.denisdb;

import java.security.SecureRandom;
import java.util.Base64;

public class CreateSecureToken {

    String token;

    public CreateSecureToken() {
        byte[] randomBytes = new byte[96];
        SecureRandom secureRandom = new SecureRandom();
        secureRandom.nextBytes(randomBytes);
        token = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(randomBytes)
                .replaceAll("[^a-zA-Z0-9]", "x");
        while (token.length() < 32) {
            byte[] additionalBytes = new byte[8];
            secureRandom.nextBytes(additionalBytes);
            token += Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(additionalBytes)
                    .replaceAll("[^a-zA-Z0-9]", "x");
        }
    }

    public String getToken() {
        return token;
    }

}
