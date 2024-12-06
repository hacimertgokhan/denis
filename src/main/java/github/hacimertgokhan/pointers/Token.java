package github.hacimertgokhan.pointers;

import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

public class Token {
    static DenisProperties denisProperties = new DenisProperties();
    static String TOKEN = String.valueOf(denisProperties.getProperty("ddb-main-token"));
    static int MAX_TOKEN_SIZE = Integer.parseInt(denisProperties.getProperty("max-token-size"));
    static DenisLogger denisLogger = new DenisLogger(Token.class);

    ConcurrentHashMap<String, String> tokens = new ConcurrentHashMap<>();

    public boolean ableToCreate() {
        JsonFile jsonFS = new JsonFile("ddb.json");
        int size;
        try {
            size = jsonFS.readJson().getJSONArray("tokens").length();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        return size > MAX_TOKEN_SIZE;
    }

    public Token(String auth) {
        if (ableToCreate()) {
            JsonFile jsonFS = new JsonFile("ddb.json");
            if (auth != null) {
                if (!tokens.contains(auth)) {
                    tokens.put(TOKEN, auth);
                    try {
                        int totalCount = jsonFS.updateArrayWithNewValue("tokens", auth);
                        denisLogger.info("New token created, (" + totalCount + "/" + MAX_TOKEN_SIZE + ")");
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                } else {
                    denisLogger.info("A token found with this value.");
                }
            }
        } else {
            denisLogger.info("You cannot create token, (Reached maximum token amount) ");
        }
    }

    public void removeToken(String token) {
        tokens.remove(token);
    }

    public void addToken(String token) {
        tokens.put(token, token);
    }

    public void burn() {
        tokens.clear();
    }

    public ConcurrentHashMap<String, String> getTokens() {
        return tokens;
    }

    public void setTokens(ConcurrentHashMap<String, String> tokens) {
        this.tokens = tokens;
    }

}
