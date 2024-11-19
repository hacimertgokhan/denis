package github.hacimertgokhan.denisdb.language.interfaces;

import github.hacimertgokhan.denisdb.language.enums.SupportedLanguages;
import github.hacimertgokhan.denisdb.language.enums.SupportedLocales;
import github.hacimertgokhan.json.JsonFile;

import java.util.Locale;

public interface DenisLanguageHandler {

    String getLanguage();
    Locale getLocale();
    boolean isSupportedLanguage(SupportedLanguages language);
    boolean isSupportedLocale(SupportedLocales locale);
    String activateLanguage();
    boolean loadLanguage();
    void test();
    JsonFile getLanguageFile();

}
