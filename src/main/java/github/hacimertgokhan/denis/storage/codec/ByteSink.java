package github.hacimertgokhan.denis.storage.codec;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Growable byte buffer with the primitive encodings used by the write-ahead log
 * and the snapshot: unsigned LEB128 varints, zig-zag signed varints and
 * length-prefixed UTF-8 strings. Not thread-safe; one per encoder.
 */
public final class ByteSink {
    private byte[] buf;
    private int size;

    public ByteSink() {
        this(128);
    }

    public ByteSink(int capacity) {
        buf = new byte[Math.max(16, capacity)];
    }

    private void ensure(int extra) {
        int needed = size + extra;
        if (needed > buf.length) {
            buf = Arrays.copyOf(buf, Math.max(needed, buf.length << 1));
        }
    }

    public ByteSink writeByte(int b) {
        ensure(1);
        buf[size++] = (byte) b;
        return this;
    }

    public ByteSink writeInt(int v) {
        ensure(4);
        buf[size++] = (byte) (v >>> 24);
        buf[size++] = (byte) (v >>> 16);
        buf[size++] = (byte) (v >>> 8);
        buf[size++] = (byte) v;
        return this;
    }

    public ByteSink writeLong(long v) {
        ensure(8);
        for (int shift = 56; shift >= 0; shift -= 8) {
            buf[size++] = (byte) (v >>> shift);
        }
        return this;
    }

    /** Unsigned varint (7 bits per byte). */
    public ByteSink writeVarLong(long v) {
        ensure(10);
        while ((v & ~0x7FL) != 0) {
            buf[size++] = (byte) ((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        buf[size++] = (byte) v;
        return this;
    }

    public ByteSink writeVarInt(int v) {
        return writeVarLong(v & 0xFFFFFFFFL);
    }

    /** Signed varint, zig-zag encoded so small negative numbers stay small. */
    public ByteSink writeZigZag(long v) {
        return writeVarLong((v << 1) ^ (v >> 63));
    }

    public ByteSink writeBytes(byte[] bytes) {
        return writeBytes(bytes, 0, bytes.length);
    }

    public ByteSink writeBytes(byte[] bytes, int offset, int length) {
        ensure(length);
        System.arraycopy(bytes, offset, buf, size, length);
        size += length;
        return this;
    }

    public ByteSink writeString(String s) {
        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
        writeVarInt(bytes.length);
        return writeBytes(bytes);
    }

    public int size() {
        return size;
    }

    public void reset() {
        size = 0;
    }

    /** Direct access to the backing array; valid bytes are {@code [0, size())}. */
    public byte[] array() {
        return buf;
    }

    public byte[] toByteArray() {
        return Arrays.copyOf(buf, size);
    }
}
