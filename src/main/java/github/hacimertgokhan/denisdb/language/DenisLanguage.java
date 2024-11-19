package github.hacimertgokhan.denisdb.language;

import github.hacimertgokhan.denisdb.language.enums.SupportedLanguages;
import github.hacimertgokhan.denisdb.language.enums.SupportedLocales;
import github.hacimertgokhan.denisdb.language.interfaces.DenisLanguageHandler;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

public class DenisLanguage implements DenisLanguageHandler {

    DenisLogger denisLogger = new DenisLogger(DenisLanguage.class);
    private final Locale systemLocale = Locale.getDefault();
    private final String language = systemLocale.getLanguage();
    private String selected = language;

    public void setSelected(String selected) {
        this.selected = selected;
    }

    /**
     * @return 
     */
    @Override
    public String getLanguage() {
        return language;
    }

    /**
     * @return
     */
    @Override
    public Locale getLocale() {
        return systemLocale;
    }

    /**
     * @param language 
     * @return
     */
    @Override
    public boolean isSupportedLanguage(SupportedLanguages language) {
        return (language == SupportedLanguages.ENGLISH) ||
                (language == SupportedLanguages.TURKISH);
    }

    /**
     * @param locale 
     * @return
     */
    @Override
    public boolean isSupportedLocale(SupportedLocales locale) {
        return (locale == SupportedLocales.US) ||
                (locale == SupportedLocales.TR);
    }

    /**
     * @return
     */
    @Override
    public String activateLanguage() {
        return selected;
    }

    /**
     * @return 
     */
    @Override
    public boolean loadLanguage() {
        JsonFile lang = new JsonFile("lang/" +activateLanguage()+".json");
        return lang.fileExists();
    }

    /**
     * @return
     */
    @Override
    public JsonFile getLanguageFile() {
        JsonFile lang = new JsonFile("lang/" +activateLanguage()+".json");
        if (lang.fileExists()) {
            return lang;
        } else {
            try {
                lang.createEmptyJson();
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            return lang;
        }
    }
    /**
     *
     */
    @Override
    public void test() {
        denisLogger.warn(activateLanguage());
        List<String> list;
        try {
            list = getLanguageFile().getList("help");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        for(String s : list) {
            System.out.println(s);
        }

    }

}
