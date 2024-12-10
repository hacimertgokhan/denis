package github.hacimertgokhan.denis.sections;

import github.hacimertgokhan.readers.DenisToml;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class Accessibility {
    private Access access;
    DenisToml toml = new DenisToml("denis.toml");

    public Accessibility(boolean only_groups) {
        if (!only_groups) {
            Map<String, Object> groups = toml.toml().toMap();
            for (String group : groups.keySet()) {
                Map<String, Object> groupDetails = toml.toml().getTable(group).toMap();
                System.out.println("Group: " + group);
                @SuppressWarnings("unchecked")
                List<String> accessibility = (List<String>) groupDetails.get("accessibility");
                for (String accessibilityItem : accessibility) {
                    System.out.println(" |-> " + accessibilityItem);
                }
                access = new Access(group, accessibility);
            }
        } else {
            Map<String, Object> groups = toml.toml().toMap();
            System.out.println("Groups:");
            for (String group : groups.keySet()) {
                System.out.println(" |-> " + group);
            }
        }
    }

    public Access getAccess() {
        return access;
    }

    public void setAccess(Access access) {
        this.access = access;
    }
}
