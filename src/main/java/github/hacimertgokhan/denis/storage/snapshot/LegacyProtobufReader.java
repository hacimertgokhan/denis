package github.hacimertgokhan.denis.storage.snapshot;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reads the {@code database.bin} file written by Denis 0.0.x so an upgrade
 * keeps its data. That file is the protobuf message
 *
 * <pre>
 *   message TokenData { string token = 1; map&lt;string,string&gt; keyValues = 2; }
 *   message Database  { repeated TokenData tokens = 1; }
 * </pre>
 *
 * where {@code token} is the project token followed by {@code ':'} and every
 * map key is prefixed the same way. The schema is small enough that decoding
 * it by hand is cheaper than keeping the protobuf runtime (and protoc) as a
 * dependency.
 */
public final class LegacyProtobufReader {
    private final byte[] data;
    private int pos;

    private LegacyProtobufReader(byte[] data) {
        this.data = data;
    }

    /** @return project token (without the trailing ':') mapped to its keys (without the prefix) */
    public static Map<String, Map<String, String>> read(Path file) throws IOException {
        byte[] bytes = Files.readAllBytes(file);
        try {
            return new LegacyProtobufReader(bytes).database();
        } catch (IndexOutOfBoundsException | IllegalStateException e) {
            throw new IOException("legacy database.bin is damaged: " + e.getMessage(), e);
        }
    }

    private Map<String, Map<String, String>> database() {
        Map<String, Map<String, String>> result = new LinkedHashMap<>();
        while (pos < data.length) {
            int tag = (int) varint();
            int field = tag >>> 3;
            int wire = tag & 7;
            if (field == 1 && wire == 2) {
                int length = (int) varint();
                int end = pos + length;
                tokenData(end, result);
                pos = end;
            } else {
                skip(wire);
            }
        }
        return result;
    }

    private void tokenData(int end, Map<String, Map<String, String>> result) {
        String token = "";
        Map<String, String> values = new LinkedHashMap<>();
        while (pos < end) {
            int tag = (int) varint();
            int field = tag >>> 3;
            int wire = tag & 7;
            if (field == 1 && wire == 2) {
                token = string();
            } else if (field == 2 && wire == 2) {
                int length = (int) varint();
                int entryEnd = pos + length;
                String key = "";
                String value = "";
                while (pos < entryEnd) {
                    int entryTag = (int) varint();
                    if (entryTag >>> 3 == 1 && (entryTag & 7) == 2) {
                        key = string();
                    } else if (entryTag >>> 3 == 2 && (entryTag & 7) == 2) {
                        value = string();
                    } else {
                        skip(entryTag & 7);
                    }
                }
                values.put(key, value);
            } else {
                skip(wire);
            }
        }
        String project = token.endsWith(":") ? token.substring(0, token.length() - 1) : token;
        String prefix = project + ":";
        Map<String, String> target = result.computeIfAbsent(project, k -> new LinkedHashMap<>());
        values.forEach((key, value) -> target.put(key.startsWith(prefix) ? key.substring(prefix.length()) : key, value));
    }

    private long varint() {
        long result = 0;
        for (int shift = 0; shift < 64; shift += 7) {
            byte b = data[pos++];
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                return result;
            }
        }
        throw new IllegalStateException("varint too long");
    }

    private String string() {
        int length = (int) varint();
        if (length < 0 || pos + length > data.length) {
            throw new IllegalStateException("string runs past the end");
        }
        String s = new String(data, pos, length, StandardCharsets.UTF_8);
        pos += length;
        return s;
    }

    private void skip(int wire) {
        switch (wire) {
            case 0 -> varint();
            case 1 -> pos += 8;
            case 2 -> pos += (int) varint();
            case 5 -> pos += 4;
            default -> throw new IllegalStateException("unsupported wire type " + wire);
        }
    }
}
