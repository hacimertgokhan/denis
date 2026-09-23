package github.hacimertgokhan.denis.storage.codec;

import java.nio.charset.StandardCharsets;

/** Reader for the encodings of {@link ByteSink}. Throws {@link CorruptRecordException} on truncation. */
public final class ByteSource {
    private final byte[] buf;
    private final int end;
    private int pos;

    public ByteSource(byte[] buf) {
        this(buf, 0, buf.length);
    }

    public ByteSource(byte[] buf, int offset, int length) {
        this.buf = buf;
        this.pos = offset;
        this.end = offset + length;
    }

    private void need(int n) {
        if (n < 0 || pos + n > end) {
            throw new CorruptRecordException("record truncated");
        }
    }

    public int readByte() {
        need(1);
        return buf[pos++] & 0xFF;
    }

    public int readInt() {
        need(4);
        return ((buf[pos++] & 0xFF) << 24) | ((buf[pos++] & 0xFF) << 16) | ((buf[pos++] & 0xFF) << 8) | (buf[pos++] & 0xFF);
    }

    public long readLong() {
        need(8);
        long v = 0;
        for (int i = 0; i < 8; i++) {
            v = (v << 8) | (buf[pos++] & 0xFF);
        }
        return v;
    }

    public long readVarLong() {
        long result = 0;
        for (int shift = 0; shift < 64; shift += 7) {
            int b = readByte();
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                return result;
            }
        }
        throw new CorruptRecordException("varint too long");
    }

    public int readVarInt() {
        long v = readVarLong();
        if (v > Integer.MAX_VALUE) {
            throw new CorruptRecordException("varint out of int range");
        }
        return (int) v;
    }

    public long readZigZag() {
        long v = readVarLong();
        return (v >>> 1) ^ -(v & 1);
    }

    public String readString() {
        int length = readVarInt();
        need(length);
        String s = new String(buf, pos, length, StandardCharsets.UTF_8);
        pos += length;
        return s;
    }

    public boolean hasRemaining() {
        return pos < end;
    }

    public int remaining() {
        return end - pos;
    }
}
