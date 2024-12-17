package github.hacimertgokhan.denis.calculators;

public class ThreadPoolCalculator {

    /**
     * Hesaplama için kullanılan iş yükü türleri.
     */
    public enum WorkloadType {
        CPU_BOUND,  // CPU yoğun işlemler - Önbellek vb.
        IO_BOUND    // I/O yoğun işlemler - Disk vb.
    }

    /**
     * İdeal iş parçacığı sayısını hesaplar.
     * @param workloadType İş yükü türü (CPU_BOUND veya IO_BOUND)
     * @param ioCpuRatio I/O ve CPU zamanı oranı (sadece IO-bound için, örn. 4.0).
     * @return İdeal iş parçacığı sayısı.
     */
    public static int calculateIdealThreads(WorkloadType workloadType, double ioCpuRatio) {
        int coreCount = Runtime.getRuntime().availableProcessors();
        return switch (workloadType) {
            case CPU_BOUND ->
                    coreCount + 1;
            case IO_BOUND ->
                    (int) Math.ceil(coreCount * (1 + ioCpuRatio));
            default -> throw new IllegalArgumentException("Unknow job thread proccess.");
        };
    }

    public int calculateCacheDatabaseThreads(double cpuIntensity, double ioIntensity) {
        int coreCount = Runtime.getRuntime().availableProcessors();
        double totalIntensity = cpuIntensity + ioIntensity;
        if (totalIntensity == 0) {
            throw new IllegalArgumentException("CPU and I/O cannot be zero.");
        }
        double cpuWeight = cpuIntensity / totalIntensity;
        double ioWeight = ioIntensity / totalIntensity;
        int cpuThreads = (int) Math.ceil(coreCount * cpuWeight);
        int ioThreads = (int) Math.ceil(coreCount * ioWeight * 4);
        return cpuThreads + ioThreads;
    }


}

