package github.hacimertgokhan.denis.storage.codec;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.CRC32C;

/**
 * Binary encoding of {@link Mutation}s and the record framing shared by the
 * write-ahead log and snapshots:
 *
 * <pre>
 *   record := length:varint  crc32c:int32  body[length]
 *   body   := op:byte fields...
 * </pre>
 *
 * The CRC covers the body, so a torn write at the end of a log (power loss) or
 * a flipped bit anywhere is detected instead of being replayed as garbage.
 */
public final class MutationCodec {
    /** Upper bound for one record; protects recovery from reading a corrupt length as "allocate 2 GB". */
    public static final int MAX_RECORD_BYTES = 256 * 1024 * 1024;

    private static final int OP_END = 0;
    private static final int OP_DEFINE_KEYSPACE = 1;
    private static final int OP_PUT = 2;
    private static final int OP_DELETE = 3;
    private static final int OP_DROP_KEYSPACE = 4;
    private static final int OP_CREATE_TABLE = 5;
    private static final int OP_ALTER_TABLE = 6;
    private static final int OP_DROP_TABLE = 7;
    private static final int OP_PUT_ROW = 8;
    private static final int OP_DELETE_ROW = 9;
    private static final int OP_CREATE_INDEX = 10;
    private static final int OP_DROP_INDEX = 11;

    private static final int V_NULL = 0;
    private static final int V_LONG = 1;
    private static final int V_DOUBLE = 2;
    private static final int V_STRING = 3;
    private static final int V_TRUE = 4;
    private static final int V_FALSE = 5;

    private MutationCodec() {
    }

    /** Encodes the body of a mutation (without framing) into {@code sink}. */
    public static void encodeBody(Mutation mutation, ByteSink sink) {
        // most frequent first: key-value and row writes
        if (mutation instanceof Mutation.Put m) {
            sink.writeByte(OP_PUT).writeVarInt(m.keyspace()).writeString(m.key()).writeString(m.value());
        } else if (mutation instanceof Mutation.PutRow m) {
            sink.writeByte(OP_PUT_ROW).writeVarInt(m.keyspace()).writeString(m.table()).writeVarLong(m.rowId());
            writeValues(m.values(), sink);
        } else if (mutation instanceof Mutation.Delete m) {
            sink.writeByte(OP_DELETE).writeVarInt(m.keyspace()).writeString(m.key());
        } else if (mutation instanceof Mutation.DeleteRow m) {
            sink.writeByte(OP_DELETE_ROW).writeVarInt(m.keyspace()).writeString(m.table()).writeVarLong(m.rowId());
        } else if (mutation instanceof Mutation.DefineKeyspace m) {
            sink.writeByte(OP_DEFINE_KEYSPACE).writeVarInt(m.keyspace()).writeString(m.name());
        } else if (mutation instanceof Mutation.DropKeyspace m) {
            sink.writeByte(OP_DROP_KEYSPACE).writeVarInt(m.keyspace());
        } else if (mutation instanceof Mutation.CreateTable m) {
            sink.writeByte(OP_CREATE_TABLE).writeVarInt(m.keyspace()).writeString(m.table()).writeString(m.schemaJson());
        } else if (mutation instanceof Mutation.AlterTable m) {
            sink.writeByte(OP_ALTER_TABLE).writeVarInt(m.keyspace()).writeString(m.table()).writeString(m.schemaJson());
        } else if (mutation instanceof Mutation.DropTable m) {
            sink.writeByte(OP_DROP_TABLE).writeVarInt(m.keyspace()).writeString(m.table());
        } else if (mutation instanceof Mutation.CreateIndex m) {
            sink.writeByte(OP_CREATE_INDEX).writeVarInt(m.keyspace()).writeString(m.table())
                    .writeString(m.name()).writeString(m.column()).writeByte(m.unique() ? 1 : 0);
        } else if (mutation instanceof Mutation.DropIndex m) {
            sink.writeByte(OP_DROP_INDEX).writeVarInt(m.keyspace()).writeString(m.table()).writeString(m.name());
        } else if (mutation instanceof Mutation.End m) {
            sink.writeByte(OP_END).writeVarLong(m.count());
        } else {
            throw new IllegalArgumentException("unknown mutation " + mutation);
        }
    }

    /** Encodes a framed record ({@code length, crc, body}) into {@code out}, using {@code scratch} for the body. */
    public static void encodeRecord(Mutation mutation, ByteSink scratch, ByteSink out) {
        scratch.reset();
        encodeBody(mutation, scratch);
        CRC32C crc = new CRC32C();
        crc.update(scratch.array(), 0, scratch.size());
        out.writeVarInt(scratch.size());
        out.writeInt((int) crc.getValue());
        out.writeBytes(scratch.array(), 0, scratch.size());
    }

    /** A framed record as a fresh array. */
    public static byte[] encodeRecord(Mutation mutation) {
        ByteSink scratch = new ByteSink(64);
        ByteSink out = new ByteSink(80);
        encodeRecord(mutation, scratch, out);
        return out.toByteArray();
    }

    public static Mutation decodeBody(byte[] body, int offset, int length) {
        ByteSource in = new ByteSource(body, offset, length);
        int op = in.readByte();
        Mutation mutation = switch (op) {
            case OP_END -> new Mutation.End(in.readVarLong());
            case OP_DEFINE_KEYSPACE -> new Mutation.DefineKeyspace(in.readVarInt(), in.readString());
            case OP_PUT -> new Mutation.Put(in.readVarInt(), in.readString(), in.readString());
            case OP_DELETE -> new Mutation.Delete(in.readVarInt(), in.readString());
            case OP_DROP_KEYSPACE -> new Mutation.DropKeyspace(in.readVarInt());
            case OP_CREATE_TABLE -> new Mutation.CreateTable(in.readVarInt(), in.readString(), in.readString());
            case OP_ALTER_TABLE -> new Mutation.AlterTable(in.readVarInt(), in.readString(), in.readString());
            case OP_DROP_TABLE -> new Mutation.DropTable(in.readVarInt(), in.readString());
            case OP_PUT_ROW -> new Mutation.PutRow(in.readVarInt(), in.readString(), in.readVarLong(), readValues(in));
            case OP_DELETE_ROW -> new Mutation.DeleteRow(in.readVarInt(), in.readString(), in.readVarLong());
            case OP_CREATE_INDEX -> new Mutation.CreateIndex(in.readVarInt(), in.readString(), in.readString(), in.readString(), in.readByte() == 1);
            case OP_DROP_INDEX -> new Mutation.DropIndex(in.readVarInt(), in.readString(), in.readString());
            default -> throw new CorruptRecordException("unknown op " + op);
        };
        if (in.hasRemaining()) {
            throw new CorruptRecordException("trailing bytes in record");
        }
        return mutation;
    }

    private static void writeValues(Object[] values, ByteSink sink) {
        sink.writeVarInt(values.length);
        for (Object value : values) {
            if (value == null) {
                sink.writeByte(V_NULL);
            } else if (value instanceof Long l) {
                sink.writeByte(V_LONG).writeZigZag(l);
            } else if (value instanceof Double d) {
                sink.writeByte(V_DOUBLE).writeLong(Double.doubleToRawLongBits(d));
            } else if (value instanceof Boolean b) {
                sink.writeByte(b ? V_TRUE : V_FALSE);
            } else {
                sink.writeByte(V_STRING).writeString(value.toString());
            }
        }
    }

    private static Object[] readValues(ByteSource in) {
        int count = in.readVarInt();
        if (count > in.remaining()) {
            throw new CorruptRecordException("value count larger than record");
        }
        Object[] values = new Object[count];
        for (int i = 0; i < count; i++) {
            int tag = in.readByte();
            values[i] = switch (tag) {
                case V_NULL -> null;
                case V_LONG -> in.readZigZag();
                case V_DOUBLE -> Double.longBitsToDouble(in.readLong());
                case V_STRING -> in.readString();
                case V_TRUE -> Boolean.TRUE;
                case V_FALSE -> Boolean.FALSE;
                default -> throw new CorruptRecordException("unknown value tag " + tag);
            };
        }
        return values;
    }

    /**
     * Reads framed records from a stream and tracks the offset just after the
     * last intact record, which is where a torn log is cut back to.
     */
    public static final class RecordReader {
        private final InputStream in;
        private long offset;
        private byte[] body = new byte[256];

        public RecordReader(InputStream in) {
            this.in = in;
        }

        /** Offset (from the start of the stream) after the last record returned by {@link #next()}. */
        public long offset() {
            return offset;
        }

        /**
         * @return the next mutation, or null at a clean end of stream
         * @throws EOFException           the stream ended inside a record (torn write)
         * @throws CorruptRecordException the record failed its checks
         */
        public Mutation next() throws IOException {
            int first = in.read();
            if (first < 0) {
                return null;
            }
            long length = first & 0x7F;
            int consumed = 1;
            int shift = 7;
            int b = first;
            while ((b & 0x80) != 0) {
                b = in.read();
                if (b < 0) {
                    throw new EOFException("log ends inside a record header");
                }
                consumed++;
                length |= (long) (b & 0x7F) << shift;
                shift += 7;
                if (shift > 35) {
                    throw new CorruptRecordException("record length varint too long");
                }
            }
            if (length <= 0 || length > MAX_RECORD_BYTES) {
                throw new CorruptRecordException("implausible record length " + length);
            }
            int crc = 0;
            for (int i = 0; i < 4; i++) {
                int c = in.read();
                if (c < 0) {
                    throw new EOFException("log ends inside a record header");
                }
                crc = (crc << 8) | c;
            }
            int len = (int) length;
            if (body.length < len) {
                body = new byte[Math.max(len, body.length * 2)];
            }
            int read = in.readNBytes(body, 0, len);
            if (read < len) {
                throw new EOFException("log ends inside a record body");
            }
            CRC32C check = new CRC32C();
            check.update(body, 0, len);
            if ((int) check.getValue() != crc) {
                throw new CorruptRecordException("checksum mismatch");
            }
            Mutation mutation = decodeBody(body, 0, len);
            offset += consumed + 4 + len;
            return mutation;
        }
    }
}
