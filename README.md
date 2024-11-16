
<h1 align="center">
    Denis Database
</h1>

<p align="center">
  <img alt="Github top language" src="https://img.shields.io/github/languages/top/hacimertgokhan/DenisDB?color=101010">

  <img alt="Github language count" src="https://img.shields.io/github/languages/count/hacimertgokhan/DenisDB?color=101010">

  <img alt="Repository size" src="https://img.shields.io/github/repo-size/hacimertgokhan/DenisDB?color=101010">

  <img alt="License" src="https://img.shields.io/github/license/hacimertgokhan/DenisDB?color=101010">

  <img alt="Github issues" src="https://img.shields.io/github/issues/hacimertgokhan/DenisDB?color=101010" /> 

  <img alt="Github forks" src="https://img.shields.io/github/forks/hacimertgokhan/DenisDB?color=101010" /> 

  <img alt="Github stars" src="https://img.shields.io/github/stars/hacimertgokhan/DenisDB?color=101010" /> 
</p>

Denis Database, Redis mantığı ile çalışan ve basit bir yapıda olan bir Java Kü
tüphanesidir. İşlemleri önbellekte tutarak geçici verilerin erişimi ve düzenlenmesinde kolaylık sağlar. Action durumları ile veritabanı kategorizasyonunu arttırarak geliştirmede kolaylık sağlar.

## DAPI

---
DDB Hakkında detaylı kütüphane bilgisi.

# Actions

---

## actString Sınıfı

**`actString`**, `String key` ve `String value` çiftiyle verileri yönetmek için tasarlanmış bir sınıftır. Bu sınıf, temel CRUD işlemleri ve verinin varlığını kontrol etmek için kullanılır.

---

### **Metodlar**
| Metod                 | Dönüş Tipi  | Açıklama |
|-----------------------|-------------|----------|
| `set(String key, String value)` | `Void`      | Belirtilen anahtar ve değeri kaydeder veya günceller. |
| `get(String key)`     | `String`    | Verilen anahtara karşılık gelen değeri döndürür. Eğer değer yoksa `null` döner. |
| `del(String key)`     | `Void`      | Belirtilen anahtarı ve değerini siler. |
| `exists(String key)`  | `Boolean`   | Verilen anahtarın mevcut olup olmadığını kontrol eder. |

---

### **Kullanım Örneği**
```java
actString actstr = new actString();

// Veri ekleme
actstr.set("key1", "value1");

// Veri alma
String value = actstr.get("key1"); // "value1"

// Veri kontrolü
boolean exists = actstr.exists("key1"); // true

// Veri silme
actstr.del("key1");
```

---

## actListrig Sınıfı

**`actListrig`**, bir `List<String>` anahtarıyla `String` değeri ilişkilendiren bir yapıdır. Paralel işlemler için uygun bir yapı olan `ConcurrentHashMap` kullanılarak oluşturulmuştur.

---

### **Metodlar**
| Metod                     | Dönüş Tipi         | Açıklama |
|---------------------------|--------------------|----------|
| `set(List<String> key, String value)` | `Void`            | Belirtilen liste anahtarı ve değer çiftini kaydeder veya günceller. |
| `get(List<String> key)`   | `String`          | Verilen liste anahtarına karşılık gelen değeri döndürür. Eğer değer yoksa `"null"` döner. |
| `del(List<String> key)`   | `Void`            | Belirtilen liste anahtarı ve değerini siler. |
| `exists(String key)`      | `Boolean`         | Verilen liste anahtarının mevcut olup olmadığını kontrol eder. |
| `getStore()`              | `ConcurrentHashMap` | Tüm veriyi döndürür. |

---

### **Kullanım Örneği**
```java
import java.util.Arrays;
import java.util.List;

actListrig actlist = new actListrig();

// Anahtar oluştur
List<String> key = Arrays.asList("item1", "item2");

// Veri ekleme
actlist.set(key, "value1");

// Veri alma
String value = actlist.get(key); // "value1"

// Veri kontrolü
boolean exists = actlist.getStore().containsKey(key); // true

// Veri silme
actlist.del(key);
```

---

## Sınıfların Farkları ve Kullanım Senaryoları

| Özellik         | actString                        | actListrig                           |
|-----------------|----------------------------------|--------------------------------------|
| **Anahtar Tipi** | `String`                        | `List<String>`                      |
| **Veri Yönetimi**| Tekil bir anahtar-değer çifti    | Çoklu anahtarları bir arada yönetme |
| **Kullanım Alanı**| Basit yapıların yönetimi        | Kompleks, hiyerarşik yapıların yönetimi |

**Örnek Senaryo:**
- **`actString`**, bir veritabanındaki kullanıcı adı-şifre çiftlerini saklamak için kullanılabilir.
- **`actListrig`**, bir e-ticaret sitesinde ürün kategorilerini ve alt kategorileri ilişkilendirmek için kullanılabilir.

--- 

Bu sınıflar, farklı veri türleri ve uygulama senaryolarında güçlü birer yardımcıdır. Paralel işlemler ve veri yönetimi açısından kolaylık sağlar.


## actStrist Sınıfı

`actStrist`, bir `String` anahtarını, bir `List<String>` değeriyle ilişkilendiren bir sınıftır. Paralel işlemler için uygun olan `ConcurrentHashMap` altyapısını kullanır. Bu sınıf, birden fazla değeri tek bir anahtara bağlamak için tasarlanmıştır.

### Metodlar

| Metod                             | Dönüş Tipi             | Açıklama                                                |
|-----------------------------------|------------------------|--------------------------------------------------------|
| `set(String key, List<String> value)` | `Void`               | Belirtilen anahtar ve değer listesini kaydeder veya günceller. |
| `get(String key)`                 | `List<String>`         | Verilen anahtara karşılık gelen değer listesini döndürür. Eğer değer yoksa `["null"]` döner. |
| `del(String key)`                 | `Void`                | Belirtilen anahtarı ve değer listesini siler.          |
| `exists(String key)`              | `Boolean`             | Verilen anahtarın mevcut olup olmadığını kontrol eder. |
| `getStore()`                      | `ConcurrentHashMap`   | Tüm veriyi döndürür.                                   |

### Kullanım Örneği

```java

        actStrist actstrist = new actStrist();

        // Anahtar ve değer listesi oluştur
        String key = "group1";
        List<String> values = Arrays.asList("item1", "item2", "item3");

        // Veri ekleme
        actstrist.set(key, values);

        // Veri alma
        List<String> retrievedValues = actstrist.get(key);
        System.out.println(retrievedValues); // [item1, item2, item3]

        // Veri kontrolü
        boolean exists = actstrist.exists(key);
        System.out.println(exists); // true

        // Veri silme
        actstrist.del(key);

        // Tekrar kontrol
        exists = actstrist.exists(key);
        System.out.println(exists); // false
```

# GlobalModal Sınıfı

`GlobalModal`, veri yönetimi işlevleri sağlayan bir sınıftır. Bu sınıf, farklı veri yapılarında (ConcurrentHashMap, HashMap, Map) veri depolamaya ve bu verilere erişim sağlamaya yönelik çeşitli metodlar içerir. Bu sınıfın temel işlevleri, verileri belirli anahtarlar altında saklamak, erişmek, silmek ve kontrol etmektir.

### 1. **Değişkenler**
- `ddbLogger`: `DDBLogger` sınıfından bir örnektir. `GlobalModal` sınıfının işlevleri ile ilgili loglama işlemleri için kullanılır.
- `ddbModal`: `DDBModals` tipinde bir değişkendir. Veri yapısının türünü belirtir (örneğin, ConcurrentHashMap, HashMap, Map).
- `ddbSubModal`: `DDBSubModals` tipinde bir değişkendir. Alt veri yapısının türünü belirtir (örneğin, `actListrig`, `actString`, `actStrist`).
- `store`: Verilerin saklandığı veri yapısını temsil eder. Bu, farklı veri yapıları olabilir ve sınıfın işlemine bağlı olarak değişir.

### 2. **Yapıcı (Constructor)**
```java
public GlobalModal(DDBModals modal, DDBSubModals subModal) {
    ddbModal = modal;
    ddbSubModal = subModal;
}
```
Bu yapıcı, `ddbModal` ve `ddbSubModal` parametrelerini alır ve bunları sınıfın ilgili değişkenlerine atar. Bu parametreler, hangi veri yapısının kullanılacağına karar verir.

### 3. **Metodlar**

#### 3.1 **`put(Any key, Any value)`**
Veriyi belirtilen anahtar (`key`) ve değer (`value`) ile `store` yapısına ekler veya günceller.

- **İşleyiş**:
    - Eğer `ddbModal` türü `CONCURRENT` ise ve `ddbSubModal` türü belirli bir değere sahipse, veri `ConcurrentHashMap` yapısına eklenir.
    - `ddbModal` farklı türlerde olursa, loglama yapılır.

#### 3.2 **`get(Any key)`**
Belirtilen anahtar (`key`) ile ilgili değeri `store` yapısından alır.

- **İşleyiş**:
    - `ddbModal` ve `ddbSubModal` türüne göre veri yapısından değeri alır.
    - Eğer veri mevcut değilse, `null` döndürülür.

#### 3.3 **`del(Any key)`**
Belirtilen anahtarı (`key`) ve değerini `store` yapısından siler.

- **İşleyiş**:
    - `ddbModal` türüne göre ilgili veri yapısından veri silinir.
    - Silme işlemi sırasında loglama yapılır.

#### 3.4 **`exists(Any key)`**
Verilen anahtarın (`key`) veri yapısında bulunup bulunmadığını kontrol eder.

- **İşleyiş**:
    - `ddbModal` ve `ddbSubModal` türüne göre, anahtarın mevcut olup olmadığı kontrol edilir.
    - Eğer anahtar varsa, `true`; yoksa `false` döndürülür.

### 4. **Kullanım Senaryosu**

`GlobalModal` sınıfı, farklı veri yapıları ve veri türlerine göre veri yönetimini esnek hale getirir. Aşağıda bu sınıfın nasıl kullanılabileceğine dair bir örnek verilmiştir.

#### Örnek:

```java
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.modals.DDBModals;
import github.hacimertgokhan.modals.DDBSubModals;
import github.hacimertgokhan.modals.GlobalModal;

public class Main {
    public static void main(String[] args) {
        // GlobalModal sınıfını oluşturma
        GlobalModal globalModal = new GlobalModal(DDBModals.CONCURRENT, DDBSubModals.actString);

        // Veri ekleme
        globalModal.put(new Any("key1"), new Any("value1"));

        // Veri alma
        Any result = globalModal.get(new Any("key1"));
        System.out.println(result.getAs(String.class)); // "value1"

        // Veri var mı kontrolü
        boolean exists = globalModal.exists(new Any("key1"));
        System.out.println(exists); // true

        // Veri silme
        globalModal.del(new Any("key1"));

        // Veri silindi mi kontrolü
        exists = globalModal.exists(new Any("key1"));
        System.out.println(exists); // false
    }
}
```

### 5. **Özellikler ve Gereksinimler**

| Özellik        | Açıklama                                                    |
|----------------|------------------------------------------------------------|
| **Veri Yapıları**| `ConcurrentHashMap`, `HashMap`, `Map` gibi farklı veri yapıları ile çalışır. |
| **Esneklik**    | `ddbModal` ve `ddbSubModal` türlerine göre işlevsellik farklılık gösterir. |
| **Loglama**     | İşlemler sırasında loglama yapılır.                        |
| **Geliştirilebilirlik** | Yeni veri yapıları ve alt veri türleri eklenebilir.  |

Bu sınıf, veri depolama ve yönetimi için oldukça esnek ve genişletilebilir bir yapı sunar, aynı zamanda farklı veri yapıları ile çalışmak için uygun bir temel oluşturur.

# Any Pointer

`Any` sınıfı, Java'da genel bir veri türü olarak kullanılabilen bir yapı sunar. Bu sınıf, içerdiği `Object` türündeki değeri farklı türlerde tutabilir ve bu değeri güvenli bir şekilde alıp değiştirmeye olanak tanır. Ayrıca, değerin tipini kontrol etmeye ve tür dönüştürme işlemleri yapmaya imkan verir.

### 1. **Değişken:**
- `value`: Bu, `Any` sınıfının tuttuğu değeri saklayan ana değişkendir. `Object` türünde tanımlanmıştır, bu sayede herhangi bir veri türünde değer tutabilir.

### 2. **Yapıcı (Constructor):**
```java
public Any(Object value) {
    this.value = value;
}
```
`Any` sınıfının yapıcısı, tutmak istediğiniz değeri (`value`) alır ve sınıfın içindeki `value` değişkenine atar.

### 3. **Metodlar:**

#### 3.1 **`getValue()`**
```java
public Object getValue() {
    return value;
}
```
Bu metod, `Any` sınıfındaki değeri almanızı sağlar. Döndürülen değer türü `Object` olduğundan, bu değeri kullanmadan önce uygun şekilde türüne dönüştürmeniz gerekir.

#### 3.2 **`setValue(Object value)`**
```java
public void setValue(Object value) {
    this.value = value;
}
```
Bu metod, `Any` sınıfındaki değeri değiştirmek için kullanılır. Yeni bir değer (`value`) alır ve bunu sınıfın içindeki `value` değişkenine atar.

#### 3.3 **`getAs(Class<T> clazz)`**
```java
public <T> T getAs(Class<T> clazz) {
    return clazz.cast(value);
}
```
Bu metod, `Any` sınıfındaki değeri güvenli bir şekilde belirtilen türe dönüştürür. `clazz.cast(value)` ile tür dönüşümü yapılır. Eğer değeri belirtilen türe dönüştürmek mümkün değilse, bir `ClassCastException` hatası fırlatılır.

#### 3.4 **`isInstanceOf(Class<?> clazz)`**
```java
public boolean isInstanceOf(Class<?> clazz) {
    return clazz.isInstance(value);
}
```
Bu metod, `Any` sınıfındaki değerin belirtilen sınıf türüne ait olup olmadığını kontrol eder. Eğer değer belirtilen sınıf türüne aitse, `true` döner; aksi takdirde `false` döner.

#### 3.5 **`isList()`**
```java
public boolean isList() {
    return value instanceof List;
}
```
Bu metod, `Any` sınıfındaki değerin bir `List` olup olmadığını kontrol eder. Eğer değer bir `List` ise `true` döner, değilse `false` döner.

#### 3.6 **`getList()`**
```java
public <T> List<T> getList() {
    if (isList()) {
        return (List<T>) value;
    }
    throw new ClassCastException("Value is not a List.");
}
```
Bu metod, `Any` sınıfındaki değerin bir `List` olduğuna emin olduktan sonra, değeri bir `List` olarak döndürür. Eğer değer bir `List` değilse, `ClassCastException` hatası fırlatılır.

### 4. **Kullanım Senaryoları**
`Any` sınıfı, farklı türdeki verileri saklamak ve bu verilere tür güvenliğiyle erişmek için kullanılır. Aşağıda, `Any` sınıfının nasıl kullanılabileceğine dair örnekler verilmiştir.

#### Örnek 1: Liste Saklamak ve Almak
```java
Any listPointer = new Any(List.of(1, 2, 3));
if (listPointer.isInstanceOf(List.class)) {
    List<Integer> myList = listPointer.getAs(List.class); // List'e dönüştürme
    System.out.println("List: " + myList); // [1, 2, 3]
}
```
Bu örnekte, `Any` sınıfı bir liste (`List`) tutuyor. `isInstanceOf` ile değerin `List` olup olmadığı kontrol edildikten sonra, `getAs` metodu ile listeye dönüştürülüyor.

#### Örnek 2: String Saklamak ve Almak
```java
Any stringPointer = new Any("Hello, World!");
if (stringPointer.isInstanceOf(String.class)) {
    String myString = stringPointer.getAs(String.class); // String'e dönüştürme
    System.out.println("String: " + myString); // "Hello, World!"
}
```
Burada, `Any` sınıfı bir `String` değerini tutuyor. Aynı şekilde, `isInstanceOf` ve `getAs` metodlarıyla güvenli bir şekilde `String` türüne dönüştürülüp kullanılıyor.

#### Örnek 3: Integer Saklamak ve Almak
```java
Any intPointer = new Any(42);
if (intPointer.isInstanceOf(Integer.class)) {
    Integer myInt = intPointer.getAs(Integer.class); // Integer'a dönüştürme
    System.out.println("Integer: " + myInt); // 42
}
```
Bu örnekte, `Any` sınıfı bir `Integer` değeri tutuyor ve yine aynı şekilde tür dönüşümü yapılıyor.

### 5. **Özet**
`Any` sınıfı, Java'da herhangi bir türde veri tutmak ve bu verilere güvenli bir şekilde erişmek için kullanılır. Verilen değerin türüne göre işlem yapmaya olanak sağlar ve tür dönüşümleri ile tip güvenliği sağlar. Bu sınıf, genel türlerde veri yönetimi gerektiren uygulamalarda oldukça kullanışlıdır.



## Yol haritası

- Kullanıcı sistemi
- Burn fonksiyonu
- Gizlilik protokolleri ile işlem döngüleri