package github.hacimertgokhan.denis.sections.group;

import github.hacimertgokhan.readers.DenisToml;

import java.io.IOException;
import java.util.List;
import java.util.Map;

public class GroupHandler {
    private String group;
    private DenisToml denisToml;
    public GroupHandler(String group) {
        this.group = group;
        denisToml = new DenisToml("denis.toml");
    }

    public String getGroup() {
        return group;
    }

    public boolean isExists() {
        DenisToml denisToml = new DenisToml("denis.toml");
        return denisToml.get(group) != null;
    }

    public List<String> getAccessList() {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        @SuppressWarnings("unchecked")
        List<String> accessibility = (List<String>) groupDetails.get("accessibility");
        return accessibility;
    }

    public boolean addAccessibility(String group, String accessibilityValue) {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();

        @SuppressWarnings("unchecked")
        List<String> accessibility = (List<String>) groupDetails.get("accessibility");

        if (!accessibility.contains(accessibilityValue)) {
            accessibility.add(accessibilityValue);
            updateGroupDetails(group, accessibility);
            return true;
        } else {
            return false;
        }
    }

    // Remove an accessibility from the group
    public boolean removeAccessibility(String group, String accessibilityValue) {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();

        @SuppressWarnings("unchecked")
        List<String> accessibility = (List<String>) groupDetails.get("accessibility");

        if (accessibility.contains(accessibilityValue)) {
            accessibility.remove(accessibilityValue);
            updateGroupDetails(group, accessibility);
            return true;
        } else {
            return false;
        }
    }

    private void updateGroupDetails(String group, List<String> accessibility) {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        groupDetails.put("accessibility", accessibility);
        try {
            denisToml.save();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        System.out.println("The TOML file has been updated.");
    }

}
