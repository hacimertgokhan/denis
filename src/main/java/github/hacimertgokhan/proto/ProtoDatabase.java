package github.hacimertgokhan.proto;

import database.*;
import github.hacimertgokhan.pointers.Any;

import java.io.*;

public class ProtoDatabase {
    private final String filePath;
    private Token.Database.Builder database;

    public ProtoDatabase(String filePath) throws IOException {
        this.filePath = filePath;
        this.database = readDatabase();
    }

    public Token.Database.Builder readDatabase() throws IOException {
        File file = new File(filePath);
        if (file.exists()) {
            try (FileInputStream fis = new FileInputStream(file)) {
                return Token.Database.newBuilder().mergeFrom(Token.Database.parseFrom(fis));
            }
        }
        return Token.Database.newBuilder();
    }

    public void writeDatabase() throws IOException {
        try (FileOutputStream fos = new FileOutputStream(filePath)) {
            database.build().writeTo(fos);
        }
    }

    public void setData(String token, String key, Any value) {
        Token.TokenData.Builder tokenData = findOrCreateToken(token);
        tokenData.putKeyValues(key, value.getAs(String.class));
        try {
            writeDatabase();
        } catch (IOException e) {
            throw new RuntimeException("Error writing to database: " + e.getMessage());
        }
    }

    public String getData(String token, String key) {
        Token.TokenData tokenData = findToken(token);
        if (tokenData != null) {
            return tokenData.getKeyValuesOrDefault(key, null);
        }
        return null;
    }

    public void deleteData(String token, String key) throws IOException {
        Token.TokenData.Builder tokenData = findOrCreateToken(token);
        tokenData.removeKeyValues(key);
        writeDatabase();
    }

    public void deleteToken(String token) throws IOException {
        database.getTokensList().removeIf(t -> t.getToken().equals(token));
        writeDatabase();
    }

    public Token.TokenData.Builder findOrCreateToken(String token) {
        for (Token.TokenData.Builder t : database.getTokensBuilderList()) {
            if (t.getToken().equals(token)) {
                return t;
            }
        }
        Token.TokenData.Builder newToken = Token.TokenData.newBuilder().setToken(token);
        database.addTokens(newToken);
        return newToken;
    }

    public Token.TokenData findToken(String token) {
        for (Token.TokenData t : database.getTokensList()) {
            if (t.getToken().equals(token)) {
                return t;
            }
        }
        return null;
    }
}
