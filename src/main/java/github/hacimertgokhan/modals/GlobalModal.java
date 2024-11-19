package github.hacimertgokhan.modals;

import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.modals.subs.DDBSubModals;
import github.hacimertgokhan.pointers.Any;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class GlobalModal {

    public DenisLogger denisLogger = new DenisLogger(GlobalModal.class);
    public DDBModals ddbModal;
    public DDBSubModals ddbSubModal;
    public ConcurrentHashMap store;

    public GlobalModal(DDBModals modal, DDBSubModals subModal) {
        ddbModal = modal;
        ddbSubModal = subModal;
    }

    public ConcurrentHashMap getStore() {
        return store;
    }

    public DDBModals getDdbModal() {
        return ddbModal;
    }

    public void put(Any key, Any value) {
        if (ddbModal != null) {
            switch (ddbModal) {
                case CONCURRENT -> {
                    if (ddbSubModal != null) {
                        switch (ddbSubModal) {
                            case actListrig -> {
                                store.put(key.getAs(List.class), value.getAs(String.class));
                            }
                            case actString -> {
                                store.put(key.getAs(String.class), value.getAs(String.class));
                            }
                            case actStrist -> {
                                store.put(key.getAs(String.class), value.getAs(List.class));
                            }
                            default -> throw new IllegalStateException("Unexpected value: " + ddbSubModal);
                        }
                    }
                }
                case HASHMAP -> {
                    denisLogger.info("HASHMAP");
                }
                case MAP -> {
                    denisLogger.info("MAP");
                }
                default -> throw new IllegalStateException("Unexpected value: " + ddbModal);
            }
        }
    }

    // GET method
    public Any get(Any key) {
        if (ddbModal != null) {
            switch (ddbModal) {
                case CONCURRENT -> {
                    if (ddbSubModal != null) {
                        switch (ddbSubModal) {
                            case actListrig -> {
                                return (Any) store.get(key.getAs(List.class));
                            }
                            case actString, actStrist -> {
                                return (Any) store.get(key.getAs(String.class));
                            }
                            default -> throw new IllegalStateException("Unexpected value: " + ddbSubModal);
                        }
                    }
                }
                case HASHMAP -> {
                    denisLogger.info("HASHMAP get operation");
                    return (Any) store.get(key.getAs(String.class));
                }
                case MAP -> {
                    denisLogger.info("MAP get operation");
                    return (Any) store.get(key.getAs(String.class));
                }
                default -> throw new IllegalStateException("Unexpected value: " + ddbModal);
            }
        }
        return null;
    }

    // DEL method
    public void del(Any key) {
        if (ddbModal != null) {
            switch (ddbModal) {
                case CONCURRENT -> {
                    if (ddbSubModal != null) {
                        switch (ddbSubModal) {
                            case actListrig -> {
                                store.remove(key.getAs(List.class));
                            }
                            case actString, actStrist -> {
                                store.remove(key.getAs(String.class));
                            }
                            default -> throw new IllegalStateException("Unexpected value: " + ddbSubModal);
                        }
                    }
                }
                case HASHMAP -> {
                    denisLogger.info("HASHMAP remove operation");
                    store.remove(key.getAs(String.class));
                }
                case MAP -> {
                    denisLogger.info("MAP remove operation");
                    store.remove(key.getAs(String.class));
                }
                default -> throw new IllegalStateException("Unexpected value: " + ddbModal);
            }
        }
    }

    // EXISTS method
    public boolean exists(Any key) {
        if (ddbModal != null) {
            switch (ddbModal) {
                case CONCURRENT -> {
                    if (ddbSubModal != null) {
                        switch (ddbSubModal) {
                            case actListrig -> {
                                return store.containsKey(key.getAs(List.class));
                            }
                            case actString, actStrist -> {
                                return store.containsKey(key.getAs(String.class));
                            }
                            default -> throw new IllegalStateException("Unexpected value: " + ddbSubModal);
                        }
                    }
                }
                case HASHMAP -> {
                    denisLogger.info("HASHMAP exists operation");
                    return store.containsKey(key.getAs(String.class));
                }
                case MAP -> {
                    denisLogger.info("MAP exists operation");
                    return store.containsKey(key.getAs(String.class));
                }
                default -> throw new IllegalStateException("Unexpected value: " + ddbModal);
            }
        }
        return false;
    }

}
