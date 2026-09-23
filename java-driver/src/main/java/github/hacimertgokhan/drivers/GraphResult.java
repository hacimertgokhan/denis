package github.hacimertgokhan.drivers;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Reply of a GraphQL-shaped {@code QUERY { ... }} document
 * ({@link DenisClient#queryGraph(String)}): {@link #data()} maps each field's
 * alias to its result; fields that failed are {@code null} there and listed
 * in {@link #errors()}.
 *
 * <p>Values are JSON-decoded: objects are {@code Map<String,Object>}, arrays
 * {@code List<Object>}, numbers {@code Long} or {@code Double}.
 */
public final class GraphResult {
    private final Map<String, Object> data;
    private final List<FieldError> errors;

    GraphResult(Map<String, Object> data, List<FieldError> errors) {
        this.data = data;
        this.errors = errors;
    }

    static GraphResult from(Map<String, Object> r) {
        Map<String, Object> data = Protocol.optObject(r.get("data"));
        List<FieldError> errors = new ArrayList<>();
        Object raw = r.get("errors");
        if (raw instanceof List) {
            for (Object o : (List<?>) raw) {
                Map<String, Object> e = Protocol.optObject(o);
                if (e != null) {
                    Object path = e.get("path");
                    errors.add(new FieldError(path == null ? null : String.valueOf(path), Protocol.optString(e, "error")));
                }
            }
        }
        return new GraphResult(Protocol.frozen(data), Collections.unmodifiableList(errors));
    }

    /** Field alias to result, in document order. */
    public Map<String, Object> data() {
        return data;
    }

    /** The result of one field (by alias), or {@code null}. */
    public Object get(String alias) {
        return data.get(alias);
    }

    /** Fields that failed; empty when every field resolved. */
    public List<FieldError> errors() {
        return errors;
    }

    /** Whether any field failed. */
    public boolean hasErrors() {
        return !errors.isEmpty();
    }

    @Override
    public String toString() {
        return "GraphResult{data=" + data.keySet() + (errors.isEmpty() ? "" : ", errors=" + errors) + "}";
    }

    /** A field of the document that could not be resolved. */
    public static final class FieldError {
        private final String path;
        private final String error;

        FieldError(String path, String error) {
            this.path = path;
            this.error = error;
        }

        /** The field's alias. */
        public String path() {
            return path;
        }

        /** Why it failed. */
        public String error() {
            return error;
        }

        @Override
        public String toString() {
            return path + ": " + error;
        }
    }
}
