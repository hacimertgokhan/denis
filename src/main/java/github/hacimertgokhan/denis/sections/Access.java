package github.hacimertgokhan.denis.sections;

import java.util.HashMap;
import java.util.List;

public class Access {

    private String group;
    private HashMap<String, String> accessList = new HashMap<>();

    public Access(String group, List<String> accessL) {
        this.group = group;
        for (String access : accessL) {
            accessList.put(group, access);
        }
    }

    public HashMap<String, String> getAccessList() {
        return accessList;
    }

    public void setAccessList(HashMap<String, String> accessList) {
        this.accessList = accessList;
    }

    public boolean groupExists(String group) {
        return accessList.containsKey(group);
    }

    public boolean canAccess(String token) {
        return accessList.containsValue(token);
    }

    public String getGroup() {
        return group;
    }

    public void setGroup(String group) {
        this.group = group;
    }
}
