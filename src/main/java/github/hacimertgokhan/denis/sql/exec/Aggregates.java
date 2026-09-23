package github.hacimertgokhan.denis.sql.exec;

import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.storage.table.Values;

import java.util.HashSet;
import java.util.Set;

/** Aggregate functions: COUNT, SUM, AVG, MIN, MAX, GROUP_CONCAT. */
public final class Aggregates {
    public static final Set<String> NAMES = Set.of("count", "sum", "avg", "min", "max", "group_concat", "total");

    private Aggregates() {
    }

    /** One aggregate call in a query: its argument (null for COUNT(*)) and DISTINCT flag. */
    public record Spec(String name, Eval argument, boolean distinct, Eval separator) {
        public Accumulator newAccumulator() {
            Accumulator inner = switch (name) {
                case "count" -> new Count(argument == null);
                case "sum" -> new Sum(false);
                case "total" -> new Sum(true);
                case "avg" -> new Avg();
                case "min" -> new Extreme(-1);
                case "max" -> new Extreme(1);
                case "group_concat" -> new Concat();
                default -> throw new SqlException("Unknown aggregate: " + name);
            };
            return distinct ? new Distinct(inner) : inner;
        }
    }

    public interface Accumulator {
        /** @param value the argument value (ignored by COUNT(*)) */
        void add(Object value, Ctx ctx);

        Object result();
    }

    private static final class Count implements Accumulator {
        private final boolean star;
        private long count;

        Count(boolean star) {
            this.star = star;
        }

        @Override
        public void add(Object value, Ctx ctx) {
            if (star || value != null) {
                count++;
            }
        }

        @Override
        public Object result() {
            return count;
        }
    }

    private static final class Sum implements Accumulator {
        private final boolean total;
        private long longSum;
        private double doubleSum;
        private boolean isDouble;
        private boolean any;

        Sum(boolean total) {
            this.total = total;
        }

        @Override
        public void add(Object value, Ctx ctx) {
            if (value == null) {
                return;
            }
            any = true;
            Object n = Operators.arithmetic("+", value, 0L);
            if (!isDouble && n instanceof Long l) {
                try {
                    longSum = Math.addExact(longSum, l);
                    return;
                } catch (ArithmeticException overflow) {
                    isDouble = true;
                    doubleSum = (double) longSum;
                }
            }
            if (!isDouble) {
                isDouble = true;
                doubleSum = longSum;
            }
            doubleSum += ((Number) n).doubleValue();
        }

        @Override
        public Object result() {
            if (!any) {
                return total ? (Object) 0.0 : null;
            }
            if (total) {
                return isDouble ? doubleSum : (double) longSum;
            }
            return isDouble ? (Object) doubleSum : (Object) longSum;
        }
    }

    private static final class Avg implements Accumulator {
        private double sum;
        private long count;

        @Override
        public void add(Object value, Ctx ctx) {
            if (value == null) {
                return;
            }
            Double d = Values.toDouble(value);
            if (d == null) {
                throw new SqlException("AVG of a non-number: '" + value + "'");
            }
            sum += d;
            count++;
        }

        @Override
        public Object result() {
            return count == 0 ? null : sum / count;
        }
    }

    private static final class Extreme implements Accumulator {
        private final int sign;
        private Object best;

        Extreme(int sign) {
            this.sign = sign;
        }

        @Override
        public void add(Object value, Ctx ctx) {
            if (value == null) {
                return;
            }
            if (best == null || Integer.signum(Values.compare(value, best)) == sign) {
                best = value;
            }
        }

        @Override
        public Object result() {
            return best;
        }
    }

    private static final class Concat implements Accumulator {
        private StringBuilder sb;
        private String separator = ",";

        void separator(String separator) {
            this.separator = separator;
        }

        @Override
        public void add(Object value, Ctx ctx) {
            if (value == null) {
                return;
            }
            if (sb == null) {
                sb = new StringBuilder();
            } else {
                sb.append(separator);
            }
            sb.append(Operators.text(value));
        }

        @Override
        public Object result() {
            return sb == null ? null : sb.toString();
        }
    }

    private static final class Distinct implements Accumulator {
        private final Accumulator inner;
        private final Set<Object> seen = new HashSet<>();

        Distinct(Accumulator inner) {
            this.inner = inner;
        }

        @Override
        public void add(Object value, Ctx ctx) {
            if (value != null && seen.add(Values.indexKey(value))) {
                inner.add(value, ctx);
            }
        }

        @Override
        public Object result() {
            return inner.result();
        }
    }

    /** GROUP_CONCAT(x, ';'): the separator is evaluated once per group from the first row. */
    public static void applySeparator(Accumulator accumulator, Spec spec, Ctx ctx) {
        if (spec.separator() == null) {
            return;
        }
        Accumulator target = accumulator instanceof Distinct d ? d.inner : accumulator;
        if (target instanceof Concat concat) {
            Object sep = spec.separator().eval(ctx);
            concat.separator(sep == null ? "" : sep.toString());
        }
    }
}
