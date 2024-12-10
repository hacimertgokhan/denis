package github.hacimertgokhan.denis.sections.group;

import github.hacimertgokhan.readers.DenisToml;

import java.util.List;
import java.util.Map;

public class GroupHandler {
    private String group;

    public GroupHandler(String group) {
        this.group = group;
    }

    public String getGroup() {
        return group;
    }

    public boolean isExists() {
        DenisToml denisToml = new DenisToml("denis.toml");
        return denisToml.get(group) != null;
    }

    public List<String> getAccessList() {
        DenisToml denisToml = new DenisToml("denis.toml");
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        @SuppressWarnings("unchecked")
        List<String> accessibility = (List<String>) groupDetails.get("accessibility");
        return accessibility;
    }

}
