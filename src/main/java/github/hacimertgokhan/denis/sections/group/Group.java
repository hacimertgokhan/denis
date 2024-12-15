package github.hacimertgokhan.denis.sections.group;

import github.hacimertgokhan.denis.fingerprint.tools.GenToHashSalter;
import github.hacimertgokhan.readers.DenisToml;

import java.io.IOException;
import java.util.List;
import java.util.Map;

public class Group {
    private String group;
    private DenisToml denisToml;
    public Group(String group) {
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
        Map<String, Object> groupDetails = denisToml.toml(). getTable(group).toMap();
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

    public String hash() {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        return (String) groupDetails.get("hash");
    }

    public String salt() {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        return (String) groupDetails.get("salt");
    }

    public boolean in(String in_pwd) {
        Map<String, Object> groupDetails = denisToml.toml().getTable(group).toMap();
        String access_ = (String) groupDetails.get("access");
        GenToHashSalter genToHashSalter = new GenToHashSalter();
        return genToHashSalter.verifyPassword(in_pwd, salt(), access_);
    }
}
