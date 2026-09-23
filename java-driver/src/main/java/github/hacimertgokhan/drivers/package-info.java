/**
 * Java driver for Denis Database (wire protocol 2).
 *
 * <p>Start with {@link github.hacimertgokhan.drivers.DenisClient#builder()}.
 * The blocking API is {@link github.hacimertgokhan.drivers.DenisClient},
 * the same commands returning {@link java.util.concurrent.CompletableFuture}s
 * are on {@link github.hacimertgokhan.drivers.DenisClient#async()}, and
 * {@link github.hacimertgokhan.drivers.Pipeline} batches commands into one
 * write. Errors are unchecked
 * {@link github.hacimertgokhan.drivers.exceptions.DenisException}s.
 *
 * <p>The driver has no runtime dependencies and runs on Java 11 or newer.
 */
package github.hacimertgokhan.drivers;
