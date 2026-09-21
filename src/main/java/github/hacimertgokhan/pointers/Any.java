package github.hacimertgokhan.pointers;

import java.util.List;

/** A cache entry: a value of any type with a few typed accessors. */
public class Any {
    private Object value;

    public Any(Object value) {
        this.value = value;
    }

    public Object getValue() {
        return value;
    }

    public void setValue(Object value) {
        this.value = value;
    }

    /** The value cast to {@code clazz}; throws {@link ClassCastException} otherwise. */
    public <T> T getAs(Class<T> clazz) {
        return clazz.cast(value);
    }

    public boolean isInstanceOf(Class<?> clazz) {
        return clazz.isInstance(value);
    }

    public boolean isList() {
        return value instanceof List;
    }

    @SuppressWarnings("unchecked")
    public <T> List<T> getList() {
        if (isList()) {
            return (List<T>) value;
        }
        throw new ClassCastException("Value is not a List.");
    }

    @Override
    public String toString() {
        return String.valueOf(value);
    }
}
