package github.hacimertgokhan.denis.storage.codec;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MutationCodecTest {

    private static List<Mutation> readAll(byte[] bytes) throws IOException {
        MutationCodec.RecordReader reader = new MutationCodec.RecordReader(new ByteArrayInputStream(bytes));
        List<Mutation> list = new ArrayList<>();
        Mutation m;
        while ((m = reader.next()) != null) {
            list.add(m);
        }
        return list;
    }

    @Test
    void everyMutationRoundTrips() throws IOException {
        List<Mutation> mutations = List.of(
                new Mutation.DefineKeyspace(7, "token-ş-ü"),
                new Mutation.Put(7, "key with ünicode", "value\twith\nnewline"),
                new Mutation.Delete(7, "k"),
                new Mutation.DropKeyspace(7),
                new Mutation.CreateTable(7, "t", "{\"columns\":[]}"),
                new Mutation.AlterTable(7, "t", "{\"columns\":[{}]}"),
                new Mutation.DropTable(7, "t"),
                new Mutation.PutRow(7, "t", 123_456_789_012L, new Object[]{null, 42L, -7L, 3.25, "x", true, false, Long.MIN_VALUE}),
                new Mutation.DeleteRow(7, "t", 1),
                new Mutation.CreateIndex(7, "t", "idx", "col", true),
                new Mutation.DropIndex(7, "t", "idx"),
                new Mutation.End(11));
        ByteSink out = new ByteSink();
        for (Mutation m : mutations) {
            out.writeBytes(MutationCodec.encodeRecord(m));
        }
        List<Mutation> back = readAll(out.toByteArray());
        assertEquals(mutations.size(), back.size());
        for (int i = 0; i < mutations.size(); i++) {
            Mutation expected = mutations.get(i);
            Mutation actual = back.get(i);
            if (expected instanceof Mutation.PutRow row) {
                Mutation.PutRow got = assertInstanceOf(Mutation.PutRow.class, actual);
                assertEquals(row.rowId(), got.rowId());
                assertArrayEquals(row.values(), got.values());
            } else {
                assertEquals(expected, actual);
            }
        }
    }

    @Test
    void flippedBitIsDetected() {
        byte[] record = MutationCodec.encodeRecord(new Mutation.Put(1, "key", "value"));
        record[record.length - 2] ^= 0x10;
        assertThrows(CorruptRecordException.class, () -> readAll(record));
    }

    @Test
    void cutOffRecordIsAnEofNotGarbage() throws IOException {
        byte[] first = MutationCodec.encodeRecord(new Mutation.Put(1, "a", "1"));
        byte[] second = MutationCodec.encodeRecord(new Mutation.Put(1, "b", "2"));
        byte[] torn = new byte[first.length + second.length - 3];
        System.arraycopy(first, 0, torn, 0, first.length);
        System.arraycopy(second, 0, torn, first.length, second.length - 3);

        MutationCodec.RecordReader reader = new MutationCodec.RecordReader(new ByteArrayInputStream(torn));
        assertEquals(new Mutation.Put(1, "a", "1"), reader.next());
        long good = reader.offset();
        assertThrows(EOFException.class, reader::next);
        assertEquals(first.length, good);
    }

    @Test
    void emptyStreamIsCleanEnd() throws IOException {
        assertNull(new MutationCodec.RecordReader(new ByteArrayInputStream(new byte[0])).next());
    }

    @Test
    void varintsAndZigZag() {
        ByteSink sink = new ByteSink(4);
        long[] values = {0, 1, 127, 128, 16_383, 16_384, Long.MAX_VALUE, -1, Long.MIN_VALUE};
        for (long v : values) {
            sink.writeZigZag(v);
        }
        ByteSource source = new ByteSource(sink.toByteArray());
        for (long v : values) {
            assertEquals(v, source.readZigZag());
        }
    }
}
