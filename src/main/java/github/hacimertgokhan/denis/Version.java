package github.hacimertgokhan.denis;

/** The version from the jar manifest ({@code dev} when running from classes). */
public final class Version {
    private Version() {
    }

    public static String get() {
        String version = Version.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }
}
