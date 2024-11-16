package github.hacimertgokhan.pointers;

import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DDBLogger;
import github.hacimertgokhan.readers.ReadDDBProp;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

public class Tokens {
    static ReadDDBProp readDDBProp = new ReadDDBProp();
    static String TOKEN = String.valueOf(readDDBProp.getProperty("ddb-main-token"));
    static int MAX_TOKEN_SIZE = Integer.parseInt(readDDBProp.getProperty("max-token-size"));
    static DDBLogger ddbLogger = new DDBLogger(Tokens.class);

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

    public Tokens(String auth) {
        if (ableToCreate()) {
            JsonFile jsonFS = new JsonFile("ddb.json");
            if (auth != null) {
                if (!tokens.contains(auth)) {
                    tokens.put(TOKEN, auth);
                    try {
                        int totalCount = jsonFS.updateArrayWithNewValue("tokens", auth);
                        ddbLogger.info("New token just created, (" + totalCount + "/" + MAX_TOKEN_SIZE + ")");
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                } else {
                    ddbLogger.info("A token found with this value.");
                }
            }
        } else {
            ddbLogger.info("You cannot create token, (Reached maximum token amount) ");
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
