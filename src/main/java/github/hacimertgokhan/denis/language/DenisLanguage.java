package github.hacimertgokhan.denis.language;

import github.hacimertgokhan.denis.language.enums.SupportedLanguages;
import github.hacimertgokhan.denis.language.enums.SupportedLocales;
import github.hacimertgokhan.denis.language.interfaces.DenisLanguageHandler;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;

import java.io.IOException;
import java.util.List;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Locale;

public class DenisLanguage implements DenisLanguageHandler {
    static DenisProperties denisProperties = new DenisProperties();
    static boolean LANG = String.valueOf(denisProperties.getProperty("language")).equals("auto");
    static String SELECTED_LANGUAGE = String.valueOf(denisProperties.getProperty("language"));

    DenisLogger denisLogger = new DenisLogger(DenisLanguage.class);
    private final Locale systemLocale = Locale.getDefault();
    private final String language = LANG ? systemLocale.getLanguage() : SELECTED_LANGUAGE;
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
                (language == SupportedLanguages.FRANCE) ||
                (language == SupportedLanguages.DENMARK) ||
                (language == SupportedLanguages.FINLAND) ||
                (language == SupportedLanguages.GREECE) ||
                (language == SupportedLanguages.SPANISH) ||
                (language == SupportedLanguages.GERMANY) ||
                (language == SupportedLanguages.TURKISH);
    }

    /**
     * @param locale 
     * @return
     */
    @Override
    public boolean isSupportedLocale(SupportedLocales locale) {
        return (locale == SupportedLocales.US) ||
                (locale == SupportedLocales.ES) ||
                (locale == SupportedLocales.FR) ||
                (locale == SupportedLocales.FI) ||
                (locale == SupportedLocales.EL) ||
                (locale == SupportedLocales.DA) ||
                (locale == SupportedLocales.DE) ||
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
    /**
     * The message file for the active language. Looked up in {@code lang/} next to
     * the working directory first; when missing, the copy bundled in the jar is
     * written there so an installation (or container) works without shipping the
     * folder separately. English is the fallback for unsupported locales.
     */
    @Override
    public JsonFile getLanguageFile() {
        for (String candidate : new String[]{activateLanguage(), "en"}) {
            JsonFile lang = new JsonFile("lang/" + candidate + ".json");
            if (lang.fileExists() || extractBundled(candidate)) {
                return lang;
            }
        }
        JsonFile lang = new JsonFile("lang/" + activateLanguage() + ".json");
        try {
            lang.createEmptyJson();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        return lang;
    }

    private boolean extractBundled(String language) {
        String resource = "lang/" + language + ".json";
        try (InputStream in = DenisLanguage.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                return false;
            }
            Path target = Paths.get(resource);
            Files.createDirectories(target.getParent());
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            return true;
        } catch (IOException e) {
            denisLogger.warn("Could not extract bundled language file " + resource + ": " + e.getMessage());
            return false;
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
