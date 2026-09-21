package github.hacimertgokhan.denis.cli;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Turns a server JSON reply into something readable on a terminal. */
final class ReplyRenderer {
    private ReplyRenderer() {
    }

    static String render(JSONObject reply) {
        if (!reply.optBoolean("ok")) {
            return "error: " + reply.optString("error", reply.toString());
        }
        if ("affected".equals(reply.optString("type"))) {
            return "OK: " + reply.optString("message", reply.optInt("affected") + " row(s) affected");
        }
        if (reply.optJSONArray("rows") != null) {
            return table(reply.optJSONArray("columns"), reply.getJSONArray("rows"))
                    + "\n(" + reply.optInt("count", reply.getJSONArray("rows").length()) + " row(s))";
        }
        if (reply.optJSONArray("tables") != null) {
            JSONArray tables = reply.getJSONArray("tables");
            if (tables.isEmpty()) {
                return "(no tables)";
            }
            StringBuilder text = new StringBuilder();
            for (int i = 0; i < tables.length(); i++) {
                JSONObject table = tables.getJSONObject(i);
                if (i > 0) {
                    text.append('\n');
                }
                text.append(table.getString("name")).append(" (").append(table.optInt("rows")).append(" rows)");
                JSONArray columns = table.optJSONArray("columns");
                if (columns != null) {
                    for (int c = 0; c < columns.length(); c++) {
                        JSONObject column = columns.getJSONObject(c);
                        text.append("\n  ").append(column.getString("name")).append("  ").append(column.optString("type", ""));
                    }
                }
            }
            return text.toString();
        }
        if (reply.optJSONArray("keys") != null) {
            JSONArray keys = reply.getJSONArray("keys");
            return keys.isEmpty() ? "(empty)" : String.join("\n", toStrings(keys));
        }
        if (reply.optJSONObject("values") != null) {
            JSONObject values = reply.getJSONObject("values");
            List<String> lines = new ArrayList<>();
            for (String key : values.keySet()) {
                lines.add(key + ": " + (values.isNull(key) ? "(nil)" : values.get(key)));
            }
            return String.join("\n", lines);
        }
        if (reply.optJSONArray("commands") != null) {
            JSONArray commands = reply.getJSONArray("commands");
            List<String> lines = new ArrayList<>();
            for (int i = 0; i < commands.length(); i++) {
                JSONObject c = commands.getJSONObject(i);
                lines.add(String.format("%-56s %s", c.getString("usage"), c.getString("description")));
            }
            return String.join("\n", lines);
        }
        if (reply.has("exists")) {
            return reply.getBoolean("exists") ? "true" : "false";
        }
        if (reply.has("data") && reply.has("key")) {
            return reply.isNull("data") ? "(nil)" : String.valueOf(reply.get("data"));
        }
        if (reply.has("token")) {
            return reply.optString("message", "ok") + "\ntoken: " + reply.getString("token");
        }
        if (reply.has("message") && reply.length() <= 3) {
            return reply.getString("message");
        }
        // INFO and anything else structured: key: value lines
        List<String> lines = new ArrayList<>();
        for (String key : reply.keySet()) {
            if (key.equals("ok")) {
                continue;
            }
            lines.add(key + ": " + reply.get(key));
        }
        return String.join("\n", lines);
    }

    static String table(JSONArray columns, JSONArray rows) {
        List<String> names = columns == null ? new ArrayList<>() : toStrings(columns);
        if (names.isEmpty() && rows.length() > 0) {
            names.addAll(rows.getJSONObject(0).keySet());
        }
        if (names.isEmpty()) {
            return "(empty)";
        }
        List<List<String>> cells = new ArrayList<>();
        for (int r = 0; r < rows.length(); r++) {
            JSONObject row = rows.getJSONObject(r);
            List<String> line = new ArrayList<>();
            for (String name : names) {
                line.add(row.isNull(name) ? "NULL" : String.valueOf(row.opt(name)));
            }
            cells.add(line);
        }
        int[] widths = new int[names.size()];
        for (int c = 0; c < names.size(); c++) {
            widths[c] = names.get(c).length();
            for (List<String> line : cells) {
                widths[c] = Math.max(widths[c], line.get(c).length());
            }
        }
        StringBuilder text = new StringBuilder();
        appendRow(text, names, widths);
        StringBuilder rule = new StringBuilder();
        for (int c = 0; c < widths.length; c++) {
            rule.append(c == 0 ? "" : "-+-").append("-".repeat(widths[c]));
        }
        text.append('\n').append(rule);
        for (List<String> line : cells) {
            text.append('\n');
            appendRow(text, line, widths);
        }
        return text.toString();
    }

    private static void appendRow(StringBuilder text, List<String> cells, int[] widths) {
        for (int c = 0; c < cells.size(); c++) {
            if (c > 0) {
                text.append(" | ");
            }
            text.append(String.format("%-" + widths[c] + "s", cells.get(c)));
        }
    }

    private static List<String> toStrings(JSONArray array) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            out.add(String.valueOf(array.get(i)));
        }
        return out;
    }
}
