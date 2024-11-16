package github.hacimertgokhan.pointers;

import java.util.List;

public class Any {
    private Object value;

    public Any(Object value) {
        this.value = value;
    }

    // Değeri alıyoruz
    public Object getValue() {
        return value;
    }

    // Değeri set ediyoruz
    public void setValue(Object value) {
        this.value = value;
    }

    // Veriyi belirli bir türde alıyoruz, güvenli casting yapıyoruz
    public <T> T getAs(Class<T> clazz) {
        return clazz.cast(value); // Tür dönüşümünü güvenli bir şekilde yapar
    }

    // Tip kontrolü ile sınıf kontrolü yapıyoruz
    public boolean isInstanceOf(Class<?> clazz) {
        return clazz.isInstance(value);
    }

    // Verinin List olup olmadığını kontrol ediyoruz
    public boolean isList() {
        return value instanceof List;
    }

    // List olarak alıyoruz
    public <T> List<T> getList() {
        if (isList()) {
            return (List<T>) value;
        }
        throw new ClassCastException("Value is not a List.");
    }


    /*
        // List tutan bir AnyPointer örneği
        AnyPointer listPointer = new AnyPointer(List.of(1, 2, 3));
        if (listPointer.isInstanceOf(List.class)) {
            List<Integer> myList = listPointer.getAs(List.class); // List'e dönüştürme
            System.out.println("List: " + myList);
        }

        // String tutan bir AnyPointer örneği
        AnyPointer stringPointer = new AnyPointer("Hello, World!");
        if (stringPointer.isInstanceOf(String.class)) {
            String myString = stringPointer.getAs(String.class); // String'e dönüştürme
            System.out.println("String: " + myString);
        }

        // Integer tutan bir AnyPointer örneği
        AnyPointer intPointer = new AnyPointer(42);
        if (intPointer.isInstanceOf(Integer.class)) {
            Integer myInt = intPointer.getAs(Integer.class); // Integer'a dönüştürme
            System.out.println("Integer: " + myInt);
        }
     */
}