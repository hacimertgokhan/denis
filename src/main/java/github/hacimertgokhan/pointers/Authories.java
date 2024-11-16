package github.hacimertgokhan.pointers;

import java.util.concurrent.ConcurrentHashMap;

public class Authories {
    private String token, tokenKey;

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getTokenKey() {
        return tokenKey;
    }

    public void setTokenKey(String tokenKey) {
        this.tokenKey = tokenKey;
    }

    // token ve repo eşleşmesi
    // her tokenin bir key değeri olacak

    public Authories(String token, String tokenKey) {
        this.token = token;
        this.tokenKey = tokenKey;
    }

}
