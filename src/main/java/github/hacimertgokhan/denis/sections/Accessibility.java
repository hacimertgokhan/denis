package github.hacimertgokhan.denis.sections;

import github.hacimertgokhan.readers.DenisToml;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class Accessibility {
    private Access access;
    DenisToml toml = new DenisToml("denis.toml");

    public Accessibility() {
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
    }

    public Access getAccess() {
        return access;
    }

    public void setAccess(Access access) {
        this.access = access;
    }
}
